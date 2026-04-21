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
 * Launch a command in a terminal window, platform-aware.
 * macOS: opens Terminal.app via osascript
 * Linux/WSL2: runs in a new tmux session directly
 */
function launchInTerminal(cmd: string, fullscreen = false): void {
  const platform = detectPlatform();

  if (platform === "macos") {
    const script = fullscreen
      ? `
      tell application "Terminal"
        do script "${cmd.replace(/"/g, '\\"')}"
        activate
        delay 0.5
        tell application "System Events" to tell process "Terminal"
          set value of attribute "AXFullScreen" of front window to true
        end tell
      end tell
    `
      : `
      tell application "Terminal"
        do script "${cmd.replace(/"/g, '\\"')}"
        activate
      end tell
    `;
    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } else {
    // Linux/WSL2: launch directly in background
    // If tmux is used, the caller handles session creation.
    // For single commands, spawn a detached bash process.
    const child = spawn("bash", ["-c", cmd], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
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
 */
export async function dispatchClaude(
  projectPath: string,
  prompt: string
): Promise<{ success: boolean; error: string | null }> {
  if (!isInsideProjectsDir(projectPath)) {
    return { success: false, error: "Invalid project path" };
  }

  try {
    const tmpFile = path.join(os.tmpdir(), `cascade-prompt-${Date.now()}.txt`);
    fsSync.writeFileSync(tmpFile, prompt, "utf-8");

    const escapedPath = projectPath.replace(/'/g, "'\\''");
    const cmd = `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    const queue = getDispatchQueue();
    await queue.enqueue({
      id: projectPath,
      dispatch: () => launchInTerminal(cmd),
    });
    return { success: true, error: null };
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
 */
function launchInPane(target: string, cmd: string): void {
  const wrapped = wrapCommand(cmd);
  execSync(
    `tmux respawn-pane -k -t ${target} '${escapeForTmux(wrapped)}'`,
    { stdio: "pipe" }
  );
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

  killTmuxSession();

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

  const paneTargets = createPaneGrid(readyJobs.map((j) => j.project.name));
  const queue = getDispatchQueue();

  for (let i = 0; i < readyJobs.length; i++) {
    const { project, cmd, prompt } = readyJobs[i];
    const target = paneTargets[i];

    await queue.enqueue({
      id: project.path,
      dispatch: async () => {
        launchInPane(target, cmd);
        await prisma.activityEvent.create({
          data: {
            projectId: project.id,
            eventType: "session-launched",
            summary: `Dispatched: ${mode} mode`,
            details: JSON.stringify({ mode, promptLength: prompt.length }),
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
  }

  try {
    execSync(
      `tmux select-window -t ${TMUX_SESSION}:projects-1 && tmux select-pane -t ${TMUX_SESSION}:projects-1.0`,
      { stdio: "pipe" }
    );
  } catch {
    // Non-fatal
  }

  attachTmuxSession(TMUX_SESSION);

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

  killTmuxSession();

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

  const paneTargets = createPaneGrid(readyJobs.map((j) => j.project.name));
  const queue = getDispatchQueue();

  for (let i = 0; i < readyJobs.length; i++) {
    const { project, cmd, prompt, mode } = readyJobs[i];
    const target = paneTargets[i];

    await queue.enqueue({
      id: project.path,
      dispatch: async () => {
        launchInPane(target, cmd);
        await prisma.activityEvent.create({
          data: {
            projectId: project.id,
            eventType: "session-launched",
            summary: `Dispatched: ${mode} mode`,
            details: JSON.stringify({ mode, promptLength: prompt.length }),
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
  }

  try {
    execSync(
      `tmux select-window -t ${TMUX_SESSION}:projects-1 && tmux select-pane -t ${TMUX_SESSION}:projects-1.0`,
      { stdio: "pipe" }
    );
  } catch {
    // Non-fatal
  }

  attachTmuxSession(TMUX_SESSION);

  return {
    launched: results.filter((r) => r.success).length,
    results,
  };
}

/**
 * Dispatch a lead Claude with agent teams enabled.
 * The lead receives a sprint plan and spawns/coordinates teammates
 * to work on multiple projects simultaneously.
 */
export async function dispatchTeam(
  prisma: PrismaClient,
  items: BatchDispatchItem[]
): Promise<{ success: boolean; error: string | null }> {
  if (items.length === 0) {
    return { success: false, error: "No projects to dispatch" };
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

Begin by spawning the team.`;

  const tmpFile = path.join(
    os.tmpdir(),
    `cascade-team-prompt-${Date.now()}.txt`
  );
  fsSync.writeFileSync(tmpFile, sprintPrompt, "utf-8");

  try {
    const cmd = `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude --teammate-mode tmux "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    // The lead agent holds exactly one queue slot regardless of team size.
    // Slot id is synthetic since team dispatch does not bind to a single project path.
    // First project's path gives a usable release key when its Stop hook fires; if no
    // projects found we fall back to a timestamp id.
    const firstFound = items.find((it) => it.slug);
    const leadId = firstFound ? `team:${firstFound.slug}` : `team:${Date.now()}`;

    const queue = getDispatchQueue();
    await queue.enqueue({
      id: leadId,
      dispatch: () => launchInTerminal(cmd, true),
    });

    return { success: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}
