/**
 * Phase 22.4 — scan ~/.claude/teams/*\/config.json for broken
 * states and surface them as structured diagnostics.
 *
 * Two failure modes the 2026-04-29 stall exhibited:
 * 1. Members written to config.json with `tmuxPaneId === ""` —
 *    the spawn handshake never completed, but the team config
 *    pretends membership succeeded.
 * 2. Teams that haven't seen any task-list activity in hours —
 *    the lead may be stalled silently.
 *
 * Pure helper (filesystem injectable for tests).
 *
 * Caller schedules this on a tick (e.g. every 10 minutes); each
 * fired diagnostic becomes an `ActivityEvent({eventType:
 * "team-stalled"})` so it surfaces in the dashboard activity feed.
 */

import { promises as fs } from "fs";
import path from "path";
import os from "os";

export interface TeamConfigMember {
  name?: string;
  tmuxPaneId?: string;
  [key: string]: unknown;
}

export interface TeamConfig {
  team_name?: string;
  members?: TeamConfigMember[];
  [key: string]: unknown;
}

export type TeamDiagnosticKind =
  | "partial-team" // some member has tmuxPaneId === ""
  | "stale-config" // config hasn't been touched in N minutes
  | "malformed"; // file exists but JSON is broken

export interface TeamDiagnostic {
  kind: TeamDiagnosticKind;
  teamName: string;
  configPath: string;
  detail: string;
}

export interface ScannerOptions {
  teamsDir?: string;
  /**
   * Spawn handshake should complete in seconds; configs older than
   * this with empty tmuxPaneIds are considered broken (not
   * mid-spawn). Default 5 minutes.
   */
  spawnHandshakeWindowMs?: number;
  /**
   * If a config hasn't been written to in this long, the team is
   * considered stale. Default 4 hours.
   */
  staleAfterMs?: number;
  /** Filesystem injection for tests. */
  fsImpl?: {
    readdir: (dir: string) => Promise<string[]>;
    readFile: (file: string) => Promise<string>;
    stat: (file: string) => Promise<{ mtimeMs: number }>;
  };
  /** Override Date.now for tests. */
  now?: () => number;
}

const defaultFsImpl = {
  readdir: (dir: string) => fs.readdir(dir),
  readFile: (file: string) => fs.readFile(file, "utf-8"),
  stat: (file: string) =>
    fs.stat(file).then((s) => ({ mtimeMs: s.mtimeMs })),
};

/**
 * Scan all team config files and return any diagnostics. An empty
 * array means everything looks healthy.
 */
export async function scanTeamConfigs(
  options: ScannerOptions = {}
): Promise<TeamDiagnostic[]> {
  const teamsDir =
    options.teamsDir ?? path.join(os.homedir(), ".claude", "teams");
  const spawnHandshakeWindowMs =
    options.spawnHandshakeWindowMs ?? 5 * 60 * 1000;
  const staleAfterMs = options.staleAfterMs ?? 4 * 60 * 60 * 1000;
  const fsImpl = options.fsImpl ?? defaultFsImpl;
  const now = options.now ?? (() => Date.now());

  let entries: string[];
  try {
    entries = await fsImpl.readdir(teamsDir);
  } catch {
    // No teams dir yet, or permission error. Not a diagnostic, just
    // nothing to scan.
    return [];
  }

  const diagnostics: TeamDiagnostic[] = [];
  const ts = now();

  for (const teamName of entries) {
    const configPath = path.join(teamsDir, teamName, "config.json");

    let mtimeMs: number;
    try {
      const stats = await fsImpl.stat(configPath);
      mtimeMs = stats.mtimeMs;
    } catch {
      // Directory entry without a config.json — skip silently.
      continue;
    }

    let raw: string;
    try {
      raw = await fsImpl.readFile(configPath);
    } catch {
      continue;
    }

    let parsed: TeamConfig;
    try {
      parsed = JSON.parse(raw);
    } catch {
      diagnostics.push({
        kind: "malformed",
        teamName,
        configPath,
        detail: "config.json is not valid JSON",
      });
      continue;
    }

    const ageMs = ts - mtimeMs;

    // Partial team: any member with empty tmuxPaneId past the
    // spawn handshake window.
    if (Array.isArray(parsed.members) && ageMs > spawnHandshakeWindowMs) {
      const orphans = parsed.members.filter(
        (m) => typeof m.tmuxPaneId === "string" && m.tmuxPaneId.length === 0
      );
      if (orphans.length > 0) {
        diagnostics.push({
          kind: "partial-team",
          teamName,
          configPath,
          detail: `${orphans.length} of ${parsed.members.length} member(s) have empty tmuxPaneId after ${Math.round(
            ageMs / 60000
          )}m — spawn handshake never completed`,
        });
      }
    }

    // Stale: config hasn't been touched in N hours.
    if (ageMs > staleAfterMs) {
      diagnostics.push({
        kind: "stale-config",
        teamName,
        configPath,
        detail: `team config last written ${Math.round(
          ageMs / 60000
        )}m ago — possible silent stall`,
      });
    }
  }

  return diagnostics;
}
