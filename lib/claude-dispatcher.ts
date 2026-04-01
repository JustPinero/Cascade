import { spawn } from "child_process";
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
    // Get the last phase directory (most recent)
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

// 3x2 grid layout: 3 columns, 2 rows per screen
const GRID_COLS = 3;
const GRID_ROWS = 2;
const TILES_PER_SCREEN = GRID_COLS * GRID_ROWS;

// Track how many windows we've opened for grid positioning
let windowIndex = 0;

/**
 * Launch Claude Code in a tiled Terminal window for a project.
 * Windows are arranged in a 3x2 grid. After 6, a new set overlaps.
 * Uses --dangerously-skip-permissions so Claude can work autonomously.
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

    // Calculate grid position for this window
    const posInGrid = windowIndex % TILES_PER_SCREEN;
    const col = posInGrid % GRID_COLS;
    const row = Math.floor(posInGrid / GRID_COLS);

    // Get screen dimensions and calculate tile size
    // Standard MacBook: ~1440x900, with menu bar ~875 usable
    const screenW = 1440;
    const screenH = 875;
    const menuBarH = 25;
    const tileW = Math.floor(screenW / GRID_COLS);
    const tileH = Math.floor(screenH / GRID_ROWS);

    const x = col * tileW;
    const y = menuBarH + row * tileH;

    const script = `
      tell application "Terminal"
        do script "cd '${escapedPath}' && claude --dangerously-skip-permissions '${escapedPrompt}'"
        set targetWindow to front window
        set bounds of targetWindow to {${x}, ${y}, ${x + tileW}, ${y + tileH}}
        activate
      end tell
    `;

    const child = spawn("osascript", ["-e", script], {
      detached: true,
      stdio: "ignore",
    });

    child.unref();
    windowIndex++;
    return { success: true, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Reset the window grid counter (call before a batch dispatch).
 */
export function resetWindowGrid(): void {
  windowIndex = 0;
}

/**
 * Dispatch Claude to all projects with "building" status.
 * Arranges Terminal windows in a 3x2 tiled grid.
 */
export async function dispatchAll(
  prisma: PrismaClient,
  mode: DispatchMode
): Promise<{ launched: number; results: DispatchResult[] }> {
  const projects = await prisma.project.findMany({
    where: { status: "building" },
  });

  // Reset grid so windows tile from top-left
  resetWindowGrid();

  const results: DispatchResult[] = [];

  for (const project of projects) {
    const prompt = await generatePrompt(project.path, mode);
    const result = dispatchClaude(project.path, prompt);

    if (result.success) {
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "session-launched",
          summary: `Dispatched: ${mode} mode`,
          details: JSON.stringify({ mode, promptLength: prompt.length }),
        },
      });
    }

    results.push({
      success: result.success,
      projectName: project.name,
      mode,
      prompt: prompt.slice(0, 200),
      error: result.error,
    });

    // Small delay between launches to avoid overwhelming the system
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    launched: results.filter((r) => r.success).length,
    results,
  };
}
