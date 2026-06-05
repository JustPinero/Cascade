/**
 * Phase 26.1 — dispatch preflight.
 *
 * The dispatcher silently failed on Windows for two months after the
 * Mac → Windows migration: spawn returned, Dispatch row committed,
 * activity event recorded, and no terminal window ever opened because
 * the bash-detached/stdio-ignored else-branch had no UI surface.
 *
 * This module fails fast instead. Given the current platform it lists
 * the tools the dispatcher will need to invoke and verifies each is
 * resolvable on PATH. The dispatcher and a future UI badge both call
 * it; tests inject a fake `whichTool` to avoid spawning `where.exe`.
 */
import { execFile } from "child_process";

export type PreflightPlatform = "macos" | "linux" | "windows";

export interface PreflightResult {
  platform: PreflightPlatform;
  ok: boolean;
  missing: string[];
  tools: Record<string, string | null>;
}

export interface PreflightDeps {
  platform?: NodeJS.Platform;
  whichTool?: (name: string) => Promise<string | null>;
}

const REQUIRED_TOOLS: Record<PreflightPlatform, string[]> = {
  macos: ["claude", "osascript"],
  linux: ["claude", "tmux", "bash"],
  windows: ["claude", "wt.exe", "bash"],
};

function toPreflightPlatform(p: NodeJS.Platform): PreflightPlatform {
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";
}

export async function checkDispatchPreflight(
  deps: PreflightDeps = {}
): Promise<PreflightResult> {
  const platform = toPreflightPlatform(deps.platform ?? process.platform);
  const whichTool = deps.whichTool ?? defaultWhichTool;
  const required = REQUIRED_TOOLS[platform];

  const tools: Record<string, string | null> = {};
  await Promise.all(
    required.map(async (name) => {
      tools[name] = await whichTool(name);
    })
  );

  const missing = required.filter((name) => tools[name] === null);
  return { platform, ok: missing.length === 0, missing, tools };
}

/**
 * Resolve a tool's path the way the OS does. `where.exe` on Windows
 * (returns absolute paths, one per line); `which` everywhere else.
 * Returns null if the tool isn't on PATH.
 */
function defaultWhichTool(name: string): Promise<string | null> {
  const cmd = process.platform === "win32" ? "where.exe" : "which";
  return new Promise((resolve) => {
    execFile(cmd, [name], (err, stdout) => {
      if (err) return resolve(null);
      const first = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0);
      resolve(first ?? null);
    });
  });
}
