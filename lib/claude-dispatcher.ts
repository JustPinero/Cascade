import { spawn, execSync } from "child_process";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import os from "os";
import { PrismaClient } from "@/app/generated/prisma/client";
import { isInsideProjectsDir } from "./validators";
import { readIfExists } from "./file-utils";

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
    execSync(`tmux kill-session -t ${TMUX_SESSION} 2>/dev/null`, {
      stdio: "pipe",
    });
  } catch {
    // Session didn't exist
  }
}

/**
 * Launch Claude Code in a single tmux pane for one project.
 * Used for single-project dispatch from the project detail page.
 */
export function dispatchClaude(
  projectPath: string,
  prompt: string
): { success: boolean; error: string | null } {
  if (!isInsideProjectsDir(projectPath)) {
    return { success: false, error: "Invalid project path" };
  }

  try {
    // Write prompt to temp file to avoid shell injection via osascript
    const tmpFile = path.join(os.tmpdir(), `cascade-prompt-${Date.now()}.txt`);
    fsSync.writeFileSync(tmpFile, prompt, "utf-8");

    const escapedPath = projectPath.replace(/'/g, "'\\''");
    const cmd = `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    const script = `
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
    `tmux set-option -t ${TMUX_SESSION} pane-border-format " #{pane_title} "`,
    `tmux set-option -t ${TMUX_SESSION} pane-border-style "fg=#2e3550"`,
    `tmux set-option -t ${TMUX_SESSION} pane-active-border-style "fg=#41a6b5"`,
  ];
  execSync(cmds.join(" && "), { stdio: "pipe" });
}

/**
 * Add a pane to the current tmux window.
 *
 * Grid layout logic:
 *   1 pane  → full screen
 *   2 panes → split horizontal (top/bottom)
 *   3 panes → 2 top, 1 bottom
 *   4 panes → 2x2 grid
 *   5 panes → 3 top, 2 bottom
 *   6 panes → 3x2 grid
 *
 * tmux's "tiled" layout handles this automatically when we
 * split and re-tile after each addition.
 */
function addPaneToWindow(
  windowTarget: string,
  cmd: string,
  projectName: string
): void {
  const wrapped = wrapCommand(cmd);
  // Split the current pane. -t targets the window.
  execSync(
    `tmux split-window -t ${windowTarget} '${escapeForTmux(wrapped)}'`,
    { stdio: "pipe" }
  );
  // Re-tile all panes in the window for even grid distribution
  execSync(`tmux select-layout -t ${windowTarget} tiled`, {
    stdio: "pipe",
  });
  // Label the new pane (always the last/active one after split)
  execSync(
    `tmux select-pane -t ${windowTarget} -T "${projectName}"`,
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

  // Kill any existing session
  killTmuxSession();

  const results: DispatchResult[] = [];
  let paneCount = 0;
  let windowCount = 0;
  let launchIndex = 0;

  // First pass: collect all dispatch-ready projects with their commands
  interface DispatchJob {
    project: typeof projects[0];
    cmd: string;
    prompt: string;
    tmpFile: string;
  }

  const jobs: DispatchJob[] = [];

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
    const tmpFile = path.join(
      os.tmpdir(),
      `cascade-prompt-${Date.now()}-${i}.txt`
    );
    fsSync.writeFileSync(tmpFile, prompt, "utf-8");
    const escapedPath = project.path.replace(/'/g, "'\\''");
    const cmd = `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude "$(cat '${tmpFile}')" ; rm -f '${tmpFile}'`;

    jobs.push({ project, cmd, prompt, tmpFile });
  }

  if (jobs.length === 0) {
    return { launched: 0, results };
  }

  // Second pass: create tmux session and add panes
  for (const job of jobs) {
    const { project, cmd, prompt } = job;
    const windowTarget = `${TMUX_SESSION}:projects-${windowCount || 1}`;

    try {
      if (launchIndex === 0) {
        // Create the tmux session with the first project
        const wrapped = wrapCommand(cmd);
        execSync(
          `tmux new-session -d -s ${TMUX_SESSION} -n "projects-1" '${escapeForTmux(wrapped)}'`,
          { stdio: "pipe" }
        );

        // Configure pane border styling
        try {
          configureTmuxSession();
        } catch {
          // Non-fatal — styling is nice-to-have
        }

        // Label the first pane
        execSync(
          `tmux select-pane -t ${TMUX_SESSION} -T "${project.name}"`,
          { stdio: "pipe" }
        );
        windowCount = 1;
        paneCount = 1;
      } else if (paneCount >= PANES_PER_WINDOW) {
        // Start a new tmux window for the next group of 6
        windowCount++;
        const wrapped = wrapCommand(cmd);
        execSync(
          `tmux new-window -t ${TMUX_SESSION} -n "projects-${windowCount}" '${escapeForTmux(wrapped)}'`,
          { stdio: "pipe" }
        );
        execSync(
          `tmux select-pane -t ${TMUX_SESSION}:projects-${windowCount} -T "${project.name}"`,
          { stdio: "pipe" }
        );
        paneCount = 1;
      } else {
        // Add a pane to the current window — tmux tiled layout handles the grid
        addPaneToWindow(windowTarget, cmd, project.name);
        paneCount++;
      }

      // Log the dispatch event
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "session-launched",
          summary: `Dispatched: ${mode} mode`,
          details: JSON.stringify({ mode, promptLength: prompt.length }),
        },
      });

      launchIndex++;

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

    // Small delay between pane launches to avoid race conditions
    await new Promise((r) => setTimeout(r, 500));
  }

  // Select the first window and first pane so the user starts there
  try {
    execSync(
      `tmux select-window -t ${TMUX_SESSION}:projects-1 && tmux select-pane -t ${TMUX_SESSION}:projects-1.0`,
      { stdio: "pipe" }
    );
  } catch {
    // Non-fatal
  }

  // Open Terminal fullscreen with the tmux session attached
  const attachScript = `
    tell application "Terminal"
      do script "tmux attach-session -t ${TMUX_SESSION}"
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

  return {
    launched: results.filter((r) => r.success).length,
    results,
  };
}
