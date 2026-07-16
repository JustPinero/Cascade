/**
 * Phase 42 (P0.2b) — dispatch liveness probe.
 *
 * The dispatcher is fire-and-forget (it never observes process exit),
 * so the watchdog's only signal used to be the `expectedBy` clock. That
 * made "hung" indistinguishable from "long-running": at 30 minutes the
 * slot was released while the Claude process might still be working —
 * defeating the RAM-aware concurrency cap exactly when it matters
 * (2× CLI processes under the WSL2 ~16GB ceiling).
 *
 * Claude Code appends to a per-project transcript on every turn:
 *   ~/.claude/projects/<encoded-project-path>/<session>.jsonl
 * The newest transcript mtime is therefore a cheap, dependency-free
 * "is anything still talking?" signal. Encoding: every character
 * outside [a-zA-Z0-9-] becomes "-" (verified against real dirs:
 * hr_hero → hr-hero, CON-CORE unchanged, leading "/" → leading "-").
 *
 * Degradation is deliberately safe: unknown dir, empty dir, or any fs
 * error returns null → the watchdog treats the row exactly as before
 * (times it out). The probe can only make the watchdog MORE patient,
 * never wedge a slot forever — expectedBy still advances and a dead
 * session stops appending, so the next tick times it out.
 */
import fs from "fs";
import os from "os";
import path from "path";

export function encodeTranscriptDirName(projectPath: string): string {
  return path.resolve(projectPath).replace(/[^a-zA-Z0-9-]/g, "-");
}

export type LivenessProbe = (projectPath: string) => Date | null;

export function defaultLivenessProbe(
  projectPath: string,
  home: string = os.homedir()
): Date | null {
  const dir = path.join(
    home,
    ".claude",
    "projects",
    encodeTranscriptDirName(projectPath)
  );
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
      if (newest === null || mtime > newest) newest = mtime;
    } catch {
      // raced with cleanup — skip
    }
  }
  return newest === null ? null : new Date(newest);
}
