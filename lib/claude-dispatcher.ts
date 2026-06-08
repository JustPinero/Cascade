import { spawn, execSync } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import { PrismaClient } from "@/app/generated/prisma/client";
import { isInsideProjectsDir } from "./validators";
import { readIfExists } from "./file-utils";
import { detectPlatform } from "./platform";
import { getDispatchQueue } from "./dispatch-queue";
import { enqueueWithDispatchRow } from "./dispatch-lifecycle";

export type DispatchMode = "continue" | "audit" | "investigate" | "custom";

export interface DispatchResult {
  success: boolean;
  projectName: string;
  projectSlug: string;
  mode: DispatchMode;
  prompt: string;
  ready: boolean;
  readyIssues: string[];
  error: string | null;
}

/**
 * Check if a project is ready for autonomous dispatch.
 */
async function checkDispatchReadiness(
  projectPath: string
): Promise<{ ready: boolean; issues: string[] }> {
  const issues: string[] = [];

  const hasClaude = await readIfExists(path.join(projectPath, "CLAUDE.md"));
  if (!hasClaude) issues.push("No CLAUDE.md — Claude won't know project standards");

  const hasGit = await readIfExists(path.join(projectPath, ".git", "HEAD"));
  if (!hasGit) issues.push("No git repo initialized");

  try {
    await fs.access(path.join(projectPath, "package.json"));
  } catch {
    // Check for other project markers
    try {
      await fs.access(path.join(projectPath, "Cargo.toml"));
    } catch {
      try {
        await fs.access(path.join(projectPath, "pyproject.toml"));
      } catch {
        issues.push("No package.json/Cargo.toml/pyproject.toml found");
      }
    }
  }

  return { ready: issues.length === 0, issues };
}

// readIfExists imported from file-utils.ts

/**
 * Load the overseer playbook preferences.
 */
async function loadPlaybook(): Promise<string> {
  const playbookPath = path.resolve(
    process.cwd(),
    "knowledge",
    "overseer-playbook.md"
  );
  const content = await readIfExists(playbookPath);
  if (!content) return "";
  // Extract just the rules, skip the title
  return content
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .join("\n");
}

/**
 * Generate the right prompt for Claude based on the project's current state.
 * Includes overseer playbook preferences in every prompt.
 */
export async function generatePrompt(
  projectPath: string,
  mode: DispatchMode,
  customPrompt?: string
): Promise<string> {
  const playbook = await loadPlaybook();
  const playbookBlock = playbook
    ? `\n\nOVERSEER RULES (follow these always):\n${playbook}`
    : "";

  if (mode === "custom" && customPrompt) {
    return customPrompt + playbookBlock;
  }

  const handoff = await readIfExists(
    path.join(projectPath, ".claude", "handoff.md")
  );
  // CLAUDE.md is read by Claude Code automatically when launched in the directory

  // Try to find the current request file
  let currentRequest = "";
  try {
    const requestsDir = path.join(projectPath, "requests");
    const phases = await fs.readdir(requestsDir);
    const sortedPhases = phases.filter((p) => p.startsWith("phase-")).sort();
    if (sortedPhases.length > 0) {
      const lastPhase = sortedPhases[sortedPhases.length - 1];
      const requests = await fs.readdir(
        path.join(requestsDir, lastPhase)
      );
      if (requests.length > 0) {
        const lastRequest = requests.sort().pop()!;
        currentRequest = await fs.readFile(
          path.join(requestsDir, lastPhase, lastRequest),
          "utf-8"
        );
      }
    }
  } catch {
    // No requests directory
  }

  let prompt: string;

  switch (mode) {
    case "continue":
      prompt = [
        "Read CLAUDE.md and .claude/handoff.md to restore context.",
        "Continue with the next request in the requests/ directory.",
        "Follow the action loop: Prime → Plan → RED → GREEN → Validate.",
        "RED FIRST: Write failing tests for every acceptance criterion BEFORE writing implementation code.",
        "GREEN: Implement until all tests pass. Then validate.",
        handoff
          ? `\nLast session handoff:\n${handoff.slice(0, 500)}`
          : "",
        currentRequest
          ? `\nNext request:\n${currentRequest.slice(0, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      break;

    case "audit":
      prompt = [
        "Read CLAUDE.md to restore context.",
        "Run the full audit suite: test-audit, bughunt, optimize, drift-audit.",
        "Write results to audits/ directory.",
        "Update .claude/handoff.md with findings.",
      ].join("\n");
      break;

    case "investigate":
      prompt = [
        "Read CLAUDE.md and .claude/handoff.md to restore context.",
        "This project has blockers. Investigate what's wrong:",
        "1. Check audits/debt.md for open items",
        "2. Run pnpm test and pnpm build to find failures",
        "3. Check git status for uncommitted work",
        "4. Write a diagnosis to .claude/handoff.md",
        handoff
          ? `\nLast session handoff:\n${handoff.slice(0, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      break;

    default:
      prompt = "Read CLAUDE.md and continue where you left off.";
  }

  return prompt + playbookBlock;
}

const TMUX_SESSION = "delamain";
const PANES_PER_WINDOW = 6; // 3x2 grid

/**
 * Kill any existing Cascade tmux session.
 */
function killTmuxSession(): void {
  try {
    execSync(`tmux kill-session -t ${TMUX_SESSION}`, {
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    // Session didn't exist
  }
}

/**
 * Phase 26 — pull a sensible wt tab title out of a dispatcher cmd. The
 * cmd always starts with `cd '<absolute path>' && …`, so the last path
 * segment is the project directory. Falls back to "Cascade" if the cmd
 * doesn't match (e.g. the team-dispatch cmd, which Windows refuses
 * anyway).
 */
function extractWtTitle(cmd: string): string {
  const m = cmd.match(/^cd '([^']+)'/);
  if (!m) return "Cascade";
  const segments = m[1].split(/[/\\]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : "Cascade";
}

/**
 * Launch a command in a terminal window, platform-aware.
 * macOS: opens Terminal.app via osascript
 * Linux/WSL2: runs in a new tmux session directly
 * Windows (Phase 26): opens a new Windows Terminal tab running Git Bash
 *
 * `extraEnv` is forwarded to the spawned child process. Phase 23.2
 * uses this to pass `CASCADE_DISPATCH_ID` through to the Stop hook.
 * On macOS the env reaches Terminal.app via the AppleScript shell
 * invocation through inline `KEY=VALUE` prefixing of the cmd string.
 * On Windows the same `KEY='val' cmd` prefix is interpreted by the
 * bash invoked inside the wt tab.
 */
function launchInTerminal(
  cmd: string,
  fullscreen = false,
  extraEnv?: Record<string, string>
): void {
  const platform = detectPlatform();
  const envPrefix = extraEnv
    ? Object.entries(extraEnv)
        .map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`)
        .join(" ") + " "
    : "";
  const cmdWithEnv = envPrefix + cmd;

  if (platform === "macos") {
    const script = fullscreen
      ? `
      tell application "Terminal"
        do script "${cmdWithEnv.replace(/"/g, '\\"')}"
        activate
        delay 0.5
        tell application "System Events" to tell process "Terminal"
          set value of attribute "AXFullScreen" of front window to true
        end tell
      end tell
    `
      : `
      tell application "Terminal"
        do script "${cmdWithEnv.replace(/"/g, '\\"')}"
        activate
      end tell
    `;
    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else if (platform === "windows") {
    // -w 0: target the current Windows Terminal window if any; create
    // one if none open. So repeated dispatches stack as tabs in the
    // same wt window instead of spawning N separate windows.
    // --suppressApplicationTitle: keep our --title intact instead of
    // letting bash overwrite it with the running command.
    // `fullscreen` is ignored on Windows — wt has no single-flag
    // fullscreen toggle and F11 is one keystroke if the user wants it.
    const title = extractWtTitle(cmd);
    const child = spawn(
      "wt.exe",
      [
        "-w",
        "0",
        "new-tab",
        "--title",
        title,
        "--suppressApplicationTitle",
        "bash",
        "-c",
        cmdWithEnv,
      ],
      {
        detached: true,
        stdio: "ignore",
      }
    );
    child.unref();
  } else {
    // Linux/WSL2: launch directly in background
    // If tmux is used, the caller handles session creation.
    // For single commands, spawn a detached bash process.
    const child = spawn("bash", ["-c", cmd], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...(extraEnv ?? {}) },
    });
    child.unref();
  }
}

/**
 * Attach to a tmux session in a terminal window, platform-aware.
 */
function attachTmuxSession(sessionName: string): void {
  const platform = detectPlatform();

  if (platform === "macos") {
    const attachScript = `
      tell application "Terminal"
        do script "tmux attach-session -t ${sessionName}"
        activate
        delay 0.5
        tell application "System Events" to tell process "Terminal"
          set value of attribute "AXFullScreen" of front window to true
        end tell
      end tell
    `;
    const child = spawn("osascript", ["-e", attachScript], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    // Linux/WSL2: just attach (user is already in a terminal)
    const child = spawn("bash", ["-c", `tmux attach-session -t ${sessionName}`], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

/**
 * Launch Claude Code in a single terminal for one project.
 * Used for single-project dispatch from the project detail page.
 *
 * Phase 23.2 — now writes a Dispatch row at enqueue and threads
 * `CASCADE_DISPATCH_ID` to the spawned process so the Stop hook can
 * round-trip it back to the webhook for deterministic idempotency.
 */
export interface DispatchClaudeResult {
  success: boolean;
  error: string | null;
  /** Phase 23.2 — populated on success; the unique key the Stop hook returns. */
  idempotencyKey?: string;
  /** Phase 23.2 — populated on success; the Dispatch row's primary key. */
  dispatchId?: string;
}

export interface DispatchClaudeOptions {
  mode?: DispatchMode;
  customPrompt?: string;
  healthAtDispatch?: string;
}

export async function dispatchClaude(
  prisma: PrismaClient,
  project: { id: number; slug: string; path: string },
  prompt: string,
  opts: DispatchClaudeOptions = {}
): Promise<DispatchClaudeResult> {
  if (!isInsideProjectsDir(project.path)) {
    return { success: false, error: "Invalid project path" };
  }

  try {
    const tmpFile = path.join(os.tmpdir(), `cascade-prompt-${Date.now()}.txt`);
    fsSync.writeFileSync(tmpFile, prompt, "utf-8");

    const escapedPath = project.path.replace(/'/g, "'\\''");
    const cmd = `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    const result = await enqueueWithDispatchRow(prisma, {
      project,
      mode: opts.mode ?? "continue",
      prompt,
      customPrompt: opts.customPrompt,
      healthAtDispatch: opts.healthAtDispatch,
      spawnFn: (idempotencyKey) =>
        launchInTerminal(cmd, false, {
          CASCADE_DISPATCH_ID: idempotencyKey,
        }),
    });

    return {
      success: true,
      error: null,
      idempotencyKey: result.idempotencyKey,
      dispatchId: result.dispatchId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Dispatch Claude to all projects with "building" status.
 * Uses tmux with 3x2 pane grids. Each tmux window holds 6 panes.
 * Swipe between tmux windows for groups of 6.
 *
 * Controls:
 *   Ctrl+B, n  → next window (next 6 projects)
 *   Ctrl+B, p  → previous window
 *   Ctrl+B, arrow → navigate between panes
 */
/**
 * Build a shell command that keeps the pane alive after the Claude session ends.
 */
function wrapCommand(cmd: string): string {
  return `${cmd}; echo ''; echo '[Session ended — press Enter to close]'; read`;
}

/**
 * Escape a command for use inside tmux shell invocations.
 * Uses double-quote escaping for tmux send-keys / new-window.
 */
function escapeForTmux(cmd: string): string {
  return cmd.replace(/'/g, "'\\''");
}

/**
 * Configure a tmux session with pane border styling.
 */
function configureTmuxSession(): void {
  const cmds = [
    `tmux set-option -t ${TMUX_SESSION} pane-border-status top`,
    `tmux set-option -t ${TMUX_SESSION} pane-border-format " [#{pane_index}] #{pane_title} "`,
    `tmux set-option -t ${TMUX_SESSION} pane-border-style "fg=#2e3550"`,
    `tmux set-option -t ${TMUX_SESSION} pane-active-border-style "fg=#41a6b5,bold"`,
    `tmux set-option -t ${TMUX_SESSION} set-titles on`,
    `tmux set-option -t ${TMUX_SESSION} set-titles-string "Cascade: #{pane_title}"`,
  ];
  execSync(cmds.join(" && "), { stdio: "pipe" });
}

/**
 * Build the shell command to run Claude Code for a single project.
 * Writes the prompt to a temp file and returns a cd + claude invocation
 * that cleans up after itself.
 */
function buildProjectCmd(projectPath: string, prompt: string, index: number): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `cascade-prompt-${Date.now()}-${index}.txt`
  );
  fsSync.writeFileSync(tmpFile, prompt, "utf-8");
  const escapedPath = projectPath.replace(/'/g, "'\\''");
  return `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;
}

/**
 * Placeholder shell command for pre-created tmux panes.
 * Shows a "queued" message and waits at an interactive bash prompt so
 * tmux can later respawn-pane into the real Claude command.
 */
function queuedPlaceholderCmd(projectName: string): string {
  const safe = projectName.replace(/'/g, "");
  return `echo '[queued: ${safe}] waiting for concurrency slot'; exec bash -i`;
}

/**
 * Create a tmux session pre-populated with one placeholder pane per job.
 * Returns the tmux pane targets in order so callers can respawn-pane
 * into the real command when the queue releases each slot.
 */
function createPaneGrid(jobNames: string[]): string[] {
  const targets: string[] = [];
  let paneCount = 0;
  let windowCount = 0;

  for (let i = 0; i < jobNames.length; i++) {
    const name = jobNames[i];
    const placeholder = queuedPlaceholderCmd(name);

    if (i === 0) {
      execSync(
        `tmux new-session -d -s ${TMUX_SESSION} -n "projects-1" '${escapeForTmux(placeholder)}'`,
        { stdio: "pipe" }
      );
      try {
        configureTmuxSession();
      } catch {
        // Styling is non-fatal
      }
      windowCount = 1;
      paneCount = 1;
      targets.push(`${TMUX_SESSION}:projects-1.0`);
    } else if (paneCount >= PANES_PER_WINDOW) {
      windowCount++;
      execSync(
        `tmux new-window -t ${TMUX_SESSION} -n "projects-${windowCount}" '${escapeForTmux(placeholder)}'`,
        { stdio: "pipe" }
      );
      paneCount = 1;
      targets.push(`${TMUX_SESSION}:projects-${windowCount}.0`);
    } else {
      const windowTarget = `${TMUX_SESSION}:projects-${windowCount}`;
      execSync(
        `tmux split-window -t ${windowTarget} '${escapeForTmux(placeholder)}'`,
        { stdio: "pipe" }
      );
      execSync(`tmux select-layout -t ${windowTarget} tiled`, {
        stdio: "pipe",
      });
      targets.push(`${windowTarget}.${paneCount}`);
      paneCount++;
    }

    try {
      execSync(
        `tmux select-pane -t ${targets[i]} -T "${name}"`,
        { stdio: "pipe" }
      );
    } catch {
      // Label failure is non-fatal
    }
  }

  return targets;
}

/**
 * Replace a pane's placeholder command with the real Claude invocation.
 * tmux respawn-pane -k kills the current placeholder and execs the new command in place.
 *
 * Phase 23.2 — `extraEnv` is shell-prefixed onto the cmd so the spawned
 * process inherits the env. tmux respawn-pane runs cmd via the user's
 * shell, so `KEY='value' cmd` is the standard mechanism.
 */
function launchInPane(
  target: string,
  cmd: string,
  extraEnv?: Record<string, string>
): void {
  const envPrefix = extraEnv
    ? Object.entries(extraEnv)
        .map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`)
        .join(" ") + " "
    : "";
  const wrapped = wrapCommand(envPrefix + cmd);
  execSync(
    `tmux respawn-pane -k -t ${target} '${escapeForTmux(wrapped)}'`,
    { stdio: "pipe" }
  );
}

/**
 * Phase 26 — platform-aware shims around the tmux helpers so the
 * multi-project dispatch paths stay one function each. On Windows the
 * tmux operations are no-ops and per-job spawn goes through
 * `launchInTerminal` (which opens a new wt tab). Linux/macOS keep
 * the tmux flow unchanged.
 */
function maybeKillTmuxSession(): void {
  if (detectPlatform() === "windows") return;
  killTmuxSession();
}

function maybeCreatePaneGrid(jobNames: string[]): string[] {
  if (detectPlatform() === "windows") {
    // Phase 29 — encode a batch-scoped window name + per-job index so
    // `launchForJob` can route the first job to `wt new-tab` (creates
    // the window) and the rest to `wt split-pane` (adds panes to that
    // named window). `cascade-<timestamp>` is stable across the loop
    // because this function runs once per dispatch.
    const windowName = `cascade-${Date.now()}`;
    return jobNames.map((_, i) => `${windowName}:${i}`);
  }
  return createPaneGrid(jobNames);
}

/**
 * Phase 29 — spawn `wt.exe` against a NAMED window so subsequent calls
 * can target the same one. wt creates the window on the first call and
 * targets it on every later one — no need to capture window IDs.
 *
 * The first job in a batch calls this with `action: "new-tab"` to
 * create the batch window. Subsequent jobs call with `"split-pane"`
 * to add panes. wt splits the active pane each time, which gives a
 * "stairs" layout rather than an even grid; refining that is a
 * follow-up if Justin asks for it.
 */
function launchInWtBatch(
  windowName: string,
  action: "new-tab" | "split-pane",
  cmd: string,
  extraEnv?: Record<string, string>
): void {
  const envPrefix = extraEnv
    ? Object.entries(extraEnv)
        .map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`)
        .join(" ") + " "
    : "";
  const cmdWithEnv = envPrefix + cmd;
  const title = extractWtTitle(cmd);
  const child = spawn(
    "wt.exe",
    [
      "-w",
      windowName,
      action,
      "--title",
      title,
      "--suppressApplicationTitle",
      "bash",
      "-c",
      cmdWithEnv,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );
  child.unref();
}

function launchForJob(
  target: string,
  cmd: string,
  extraEnv: Record<string, string>
): void {
  if (detectPlatform() === "windows") {
    // target shape from maybeCreatePaneGrid: "<windowName>:<index>".
    const sepIdx = target.indexOf(":");
    const windowName = sepIdx > 0 ? target.slice(0, sepIdx) : "0";
    const index = sepIdx > 0 ? parseInt(target.slice(sepIdx + 1), 10) : 0;
    const action = index === 0 ? "new-tab" : "split-pane";
    launchInWtBatch(windowName, action, cmd, extraEnv);
    return;
  }
  launchInPane(target, cmd, extraEnv);
}

function maybeFocusFirstPane(): void {
  if (detectPlatform() === "windows") return;
  try {
    execSync(
      `tmux select-window -t ${TMUX_SESSION}:projects-1 && tmux select-pane -t ${TMUX_SESSION}:projects-1.0`,
      { stdio: "pipe" }
    );
  } catch {
    // Non-fatal
  }
}

function maybeAttachTmuxSession(): void {
  if (detectPlatform() === "windows") return;
  attachTmuxSession(TMUX_SESSION);
}

export async function dispatchAll(
  prisma: PrismaClient,
  mode: DispatchMode
): Promise<{ launched: number; results: DispatchResult[] }> {
  const projects = await prisma.project.findMany({
    where: { status: "building" },
  });

  if (projects.length === 0) {
    return { launched: 0, results: [] };
  }

  maybeKillTmuxSession();

  const results: DispatchResult[] = [];
  interface ReadyJob {
    project: typeof projects[0];
    cmd: string;
    prompt: string;
  }
  const readyJobs: ReadyJob[] = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const readiness = await checkDispatchReadiness(project.path);
    if (!readiness.ready) {
      results.push({
        success: false,
        projectName: project.name,
        projectSlug: project.slug,
        mode,
        prompt: "",
        ready: false,
        readyIssues: readiness.issues,
        error: `Not dispatch-ready: ${readiness.issues.join(", ")}`,
      });
      continue;
    }

    const prompt = await generatePrompt(project.path, mode);
    const cmd = buildProjectCmd(project.path, prompt, i);
    readyJobs.push({ project, cmd, prompt });
  }

  if (readyJobs.length === 0) {
    return { launched: 0, results };
  }

  const paneTargets = maybeCreatePaneGrid(readyJobs.map((j) => j.project.name));

  for (let i = 0; i < readyJobs.length; i++) {
    const { project, cmd, prompt } = readyJobs[i];
    const target = paneTargets[i];

    // Phase 23.5.1 — wrap per-project enqueue. The lifecycle helper
    // marks the Dispatch row failed on spawn throw and rethrows; the
    // queue rethrows that out of enqueue. Without this catch, one
    // project's failure would abort the rest of the batch. Capture
    // the per-project error in `results` and continue the loop.
    try {
      await enqueueWithDispatchRow(prisma, {
        project,
        mode,
        prompt,
        healthAtDispatch: project.health,
        spawnFn: async (idempotencyKey) => {
          launchForJob(target, cmd, { CASCADE_DISPATCH_ID: idempotencyKey });
          await prisma.activityEvent.create({
            data: {
              projectId: project.id,
              eventType: "session-launched",
              summary: `Dispatched: ${mode} mode`,
              details: JSON.stringify({
                mode,
                promptLength: prompt.length,
                idempotencyKey,
              }),
            },
          });
        },
      });

      results.push({
        success: true,
        projectName: project.name,
        projectSlug: project.slug,
        mode,
        prompt: prompt.slice(0, 300),
        ready: true,
        readyIssues: [],
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        success: false,
        projectName: project.name,
        projectSlug: project.slug,
        mode,
        prompt: prompt.slice(0, 300),
        ready: true,
        readyIssues: [],
        error: message,
      });
    }
  }

  maybeFocusFirstPane();
  maybeAttachTmuxSession();

  return {
    launched: results.filter((r) => r.success).length,
    results,
  };
}

export interface BatchDispatchItem {
  slug: string;
  mode: DispatchMode;
  prompt?: string;
}

/**
 * Dispatch specific projects in a tmux grid.
 * Unlike dispatchAll (which dispatches all building projects),
 * this accepts a specific list with per-project modes and prompts.
 */
export async function dispatchBatch(
  prisma: PrismaClient,
  items: BatchDispatchItem[]
): Promise<{ launched: number; results: DispatchResult[] }> {
  if (items.length === 0) {
    return { launched: 0, results: [] };
  }

  maybeKillTmuxSession();

  const results: DispatchResult[] = [];
  interface ReadyBatchJob {
    project: { id: number; name: string; slug: string; path: string };
    cmd: string;
    prompt: string;
    mode: DispatchMode;
  }
  const readyJobs: ReadyBatchJob[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const project = await prisma.project.findUnique({
      where: { slug: item.slug },
    });

    if (!project) {
      results.push({
        success: false,
        projectName: item.slug,
        projectSlug: item.slug,
        mode: item.mode,
        prompt: "",
        ready: false,
        readyIssues: ["Project not found"],
        error: "Project not found",
      });
      continue;
    }

    const readiness = await checkDispatchReadiness(project.path);
    if (!readiness.ready) {
      results.push({
        success: false,
        projectName: project.name,
        projectSlug: project.slug,
        mode: item.mode,
        prompt: "",
        ready: false,
        readyIssues: readiness.issues,
        error: `Not dispatch-ready: ${readiness.issues.join(", ")}`,
      });
      continue;
    }

    const prompt = await generatePrompt(project.path, item.mode, item.prompt);
    const cmd = buildProjectCmd(project.path, prompt, i);
    readyJobs.push({ project, cmd, prompt, mode: item.mode });
  }

  if (readyJobs.length === 0) {
    return { launched: 0, results };
  }

  const paneTargets = maybeCreatePaneGrid(readyJobs.map((j) => j.project.name));

  for (let i = 0; i < readyJobs.length; i++) {
    const { project, cmd, prompt, mode } = readyJobs[i];
    const target = paneTargets[i];

    // Phase 23.5.1 — see dispatchAll for the rationale; same pattern.
    try {
      await enqueueWithDispatchRow(prisma, {
        project,
        mode,
        prompt,
        spawnFn: async (idempotencyKey) => {
          launchForJob(target, cmd, { CASCADE_DISPATCH_ID: idempotencyKey });
          await prisma.activityEvent.create({
            data: {
              projectId: project.id,
              eventType: "session-launched",
              summary: `Dispatched: ${mode} mode`,
              details: JSON.stringify({
                mode,
                promptLength: prompt.length,
                idempotencyKey,
              }),
            },
          });
        },
      });

      results.push({
        success: true,
        projectName: project.name,
        projectSlug: project.slug,
        mode,
        prompt: prompt.slice(0, 300),
        ready: true,
        readyIssues: [],
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        success: false,
        projectName: project.name,
        projectSlug: project.slug,
        mode,
        prompt: prompt.slice(0, 300),
        ready: true,
        readyIssues: [],
        error: message,
      });
    }
  }

  maybeFocusFirstPane();
  maybeAttachTmuxSession();

  return {
    launched: results.filter((r) => r.success).length,
    results,
  };
}

/**
 * Dispatch a lead Claude with agent teams enabled.
 * The lead receives a sprint plan and spawns/coordinates teammates
 * to work on multiple projects simultaneously.
 *
 * Phase 23 follow-up P0.2 (v1) — the LEAD now writes a Dispatch row
 * via the lifecycle helper. CASCADE_DISPATCH_ID is threaded into
 * the lead's spawn env so the lead's Stop hook completes the row.
 * Per-teammate Dispatch rows are NOT yet wired (v2 work) — teammate
 * Stop hooks fall back to the legacy lookup until then.
 */
export interface DispatchTeamResult {
  success: boolean;
  error: string | null;
  /** v1 — lead's idempotencyKey, populated on success. */
  idempotencyKey?: string;
  /** v1 — lead's Dispatch.id, populated on success. */
  dispatchId?: string;
}

export async function dispatchTeam(
  prisma: PrismaClient,
  items: BatchDispatchItem[]
): Promise<DispatchTeamResult> {
  if (items.length === 0) {
    return { success: false, error: "No projects to dispatch" };
  }

  // Phase 26 — Claude Code's --teammate-mode is tmux-only, and the
  // wt + Git Bash environment we use on Windows has no tmux. Fail loud
  // instead of pretending the team launched.
  if (detectPlatform() === "windows") {
    return {
      success: false,
      error:
        "Agent teams require tmux — not supported on Windows. Use single dispatch or 'Resume All' instead.",
    };
  }

  killTmuxSession();

  const projectDetails: string[] = [];

  for (const item of items) {
    const project = await prisma.project.findUnique({
      where: { slug: item.slug },
    });
    if (!project) continue;

    let handoff = "";
    try {
      handoff = fsSync
        .readFileSync(`${project.path}/.claude/handoff.md`, "utf-8")
        .slice(0, 500);
    } catch {
      // No handoff
    }

    projectDetails.push(`## ${project.name} (${project.slug})
Path: ${project.path}
Mode: ${item.mode}
${item.prompt ? `Instructions: ${item.prompt}` : ""}
${handoff ? `Last session: ${handoff.slice(0, 300)}` : "No previous context."}
`);

    await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-launched",
        summary: `Dispatched via agent team: ${item.mode} mode`,
        details: JSON.stringify({ mode: item.mode, teamDispatch: true }),
      },
    });
  }

  let playbookContent = "";
  try {
    playbookContent = fsSync.readFileSync(
      path.resolve(process.cwd(), "knowledge", "overseer-playbook.md"),
      "utf-8"
    );
  } catch {
    // No playbook
  }

  const sprintPrompt = `You are Delamain — the AI fleet dispatcher. Sprint plan: ${items.length} projects.

## Your Role
You are the LEAD agent. Spawn ${items.length} TEAMMATES, one per project. Each works in their project directory. You coordinate, monitor, reassign if stuck, synthesize results.

## Sprint Plan
${projectDetails.join("\n")}

## Rules
${playbookContent ? `### Overseer Playbook\n${playbookContent}\n` : ""}
- Spawn one teammate per project
- Each teammate: cd to project path, read CLAUDE.md, read .claude/handoff.md, then execute their mode
- Use tmux teammate mode so all panes are visible
- Monitor via shared task list
- If teammate hits a blocker, investigate and help
- When done, write sprint summary with [LESSON] and [HUMAN TODO] tags

## Failure handling — non-negotiable (Phase 22.5 hardening)
The 2026-04-29 stall happened because a parallel Agent batch failed,
the lead got opaque error results, and ended its turn silently. To
prevent that recurring:

- After EVERY Agent batch (especially parallel ones), inspect each
  result. If any tool result is empty, opaque ("[Tool result missing
  due to internal error]"), or contains an error string, you MUST:
    1. Acknowledge the error in user-visible text BEFORE yielding
       the turn. Silent yield on tool errors is a bug.
    2. Try ONE retry of the failing call(s), only if the cause is
       transient (transport / session). Do not retry if the error
       indicates a code-level problem.
    3. If retry fails, surface the diagnosis to the user with
       concrete next steps (reset session, switch transport, abort
       sprint).
- If every tool call in a batch errored — even more important. Never
  end the turn without text. The user has no signal otherwise.
- If you spawn teammates and the team config file
  (~/.claude/teams/*/config.json) shows members with
  tmuxPaneId == "" after the spawn handshake, the team is broken.
  Do not pretend it succeeded. Tell the user.

Begin by spawning the team.`;

  const tmpFile = path.join(
    os.tmpdir(),
    `cascade-team-prompt-${Date.now()}.txt`
  );
  fsSync.writeFileSync(tmpFile, sprintPrompt, "utf-8");

  try {
    const cmd = `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude --teammate-mode tmux "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    // P0.2 v1 — anchor the lead's Dispatch row to the first known
    // project in the batch. The lead spawn carries CASCADE_DISPATCH_ID
    // for that row's idempotencyKey; when the LEAD's Stop hook fires,
    // the webhook completes the row. Per-teammate rows are NOT
    // written (v2 work) — teammate Stop hooks still fall back to the
    // legacy session-launched lookup.
    const firstFound = items.find((it) => it.slug);
    if (!firstFound) {
      return { success: false, error: "No valid projects in dispatch list" };
    }
    const leadProject = await prisma.project.findUnique({
      where: { slug: firstFound.slug },
    });
    if (!leadProject) {
      return {
        success: false,
        error: `Lead project not found: ${firstFound.slug}`,
      };
    }

    const result = await enqueueWithDispatchRow(prisma, {
      project: leadProject,
      mode: "custom",
      prompt: sprintPrompt.slice(0, 500),
      healthAtDispatch: leadProject.health,
      spawnFn: (idempotencyKey) =>
        launchInTerminal(cmd, true, { CASCADE_DISPATCH_ID: idempotencyKey }),
    });

    return {
      success: true,
      error: null,
      idempotencyKey: result.idempotencyKey,
      dispatchId: result.dispatchId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
