/**
 * Phase 22.2 — pre-flight validator for iTerm sessions used by
 * `dispatchTeam`. Closes the failure mode reported in the
 * Delamain 2026-04-29 stall: a lead Claude Code session was
 * dispatched into an iTerm session that had been torn down,
 * causing teammate spawns to silently fail downstream.
 *
 * The transport-layer fix (better Agent error reporting,
 * partial-team rollback) lives inside Claude Code itself —
 * filed separately as a bug. This is the orchestration-side
 * gate that refuses to dispatch into a dead session in the
 * first place.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Subprocess injection so tests can run without invoking osascript.
 * Returns whatever the runner produces (stdout); throws on non-zero
 * exit (matching execFile's default).
 */
export type OsascriptRunner = (script: string) => Promise<string>;

const defaultRunner: OsascriptRunner = async (script) => {
  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: 5000,
  });
  return stdout;
};

/**
 * Returns true if `sessionId` is a live iTerm session — meaning
 * iTerm is running AND knows about a session with that UUID.
 *
 * Defensive: any error (osascript missing, iTerm not running,
 * timeout, malformed input) returns false. The contract is
 * "true means definitely alive" — false means "not safe to
 * dispatch into."
 */
export async function isITermSessionAlive(
  sessionId: string,
  runner: OsascriptRunner = defaultRunner
): Promise<boolean> {
  if (typeof sessionId !== "string") return false;
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) return false;

  // Reject anything that looks unsafe to interpolate — we control
  // the script body, but a malformed UUID-shaped input shouldn't
  // crash the AppleScript parser. UUIDs are hex + dashes.
  if (!/^[A-Fa-f0-9-]+$/.test(trimmed)) return false;

  // AppleScript: ask iTerm whether any session has the given
  // unique ID. Returns "true" or "false" as text. Any error
  // (iTerm not running, bad permissions, timeout) → false.
  const script = `
    tell application "iTerm"
      try
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if (unique id of s) = "${trimmed}" then
                return "true"
              end if
            end repeat
          end repeat
        end repeat
        return "false"
      on error
        return "false"
      end try
    end tell
  `;

  try {
    const out = await runner(script);
    return out.trim() === "true";
  } catch {
    return false;
  }
}
