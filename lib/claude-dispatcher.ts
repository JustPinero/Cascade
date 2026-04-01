import { spawn, execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { isInsideProjectsDir } from "./validators";

export type DispatchMode = "continue" | "audit" | "investigate" | "custom";

export interface DispatchResult {
  success: boolean;
  projectName: string;
  mode: DispatchMode;
  prompt: string;
  error: string | null;
}

/**
 * Read a file if it exists, return empty string if not.
 */
async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Generate the right prompt for Claude based on the project's current state.
 */
export async function generatePrompt(
  projectPath: string,
  mode: DispatchMode,
  customPrompt?: string
): Promise<string> {
  if (mode === "custom" && customPrompt) {
    return customPrompt;
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

  switch (mode) {
    case "continue":
      return [
        "Read CLAUDE.md and .claude/handoff.md to restore context.",
        "Continue with the next request in the requests/ directory.",
        "Follow the action loop: Prime → Plan → Execute → Validate.",
        handoff
          ? `\nLast session handoff:\n${handoff.slice(0, 500)}`
          : "",
        currentRequest
          ? `\nNext request:\n${currentRequest.slice(0, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

    case "audit":
      return [
        "Read CLAUDE.md to restore context.",
        "Run the full audit suite: test-audit, bughunt, optimize, drift-audit.",
        "Write results to audits/ directory.",
        "Update .claude/handoff.md with findings.",
      ].join("\n");

    case "investigate":
      return [
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

    default:
      return "Read CLAUDE.md and continue where you left off.";
  }
}

const TMUX_SESSION = "cascade";
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
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const escapedPath = projectPath.replace(/'/g, "'\\''");
    const cmd = `cd '${escapedPath}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude '${escapedPrompt}'`;

    // For single dispatch, open in a new Terminal window
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

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const prompt = await generatePrompt(project.path, mode);
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const cmd = `cd '${project.path}' && CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true claude '${escapedPrompt}'`;

    try {
      if (i === 0) {
        // Create the tmux session with the first project
        execSync(
          `tmux new-session -d -s ${TMUX_SESSION} -n "projects-1" "${cmd}"`,
          { stdio: "pipe" }
        );
        windowCount = 1;
        paneCount = 1;
      } else if (paneCount >= PANES_PER_WINDOW) {
        // Start a new tmux window for the next group
        windowCount++;
        execSync(
          `tmux new-window -t ${TMUX_SESSION} -n "projects-${windowCount}" "${cmd}"`,
          { stdio: "pipe" }
        );
        paneCount = 1;
      } else {
        // Split the current window to add a new pane
        execSync(
          `tmux split-window -t ${TMUX_SESSION} "${cmd}"`,
          { stdio: "pipe" }
        );
        // Rebalance to keep the grid tidy
        execSync(
          `tmux select-layout -t ${TMUX_SESSION} tiled`,
          { stdio: "pipe" }
        );
        paneCount++;
      }

      // Log the event
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "session-launched",
          summary: `Dispatched: ${mode} mode`,
          details: JSON.stringify({ mode, promptLength: prompt.length }),
        },
      });

      results.push({
        success: true,
        projectName: project.name,
        mode,
        prompt: prompt.slice(0, 200),
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        success: false,
        projectName: project.name,
        mode,
        prompt: prompt.slice(0, 200),
        error: message,
      });
    }

    // Small delay between launches
    await new Promise((r) => setTimeout(r, 300));
  }

  // Open Terminal with the tmux session attached
  const attachScript = `
    tell application "Terminal"
      do script "tmux attach-session -t ${TMUX_SESSION}"
      activate
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
