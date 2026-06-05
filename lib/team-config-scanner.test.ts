import { describe, it, expect, vi } from "vitest";
import { scanTeamConfigs } from "@/lib/team-config-scanner";

const NOW = 1735689600000; // fixed reference; ~2025-01

// Mock fs that maps file paths back to a per-team config table.
// Extract the team name from the second-to-last path segment
// (matches both /fake/<team>/config.json AND /home/.claude/teams/<team>/config.json).
// Phase 27 — split on `/` AND `\` so paths built by `path.join` on a
// Windows host (which uses backslashes) still resolve correctly.
function teamFromPath(file: string): string {
  const parts = file.split(/[/\\]/);
  return parts[parts.length - 2] ?? "";
}

function makeFs(state: {
  teams?: string[];
  configs?: Record<string, { json: string; mtimeMs: number }>;
  readdirFails?: boolean;
}) {
  const teams = state.teams ?? [];
  const configs = state.configs ?? {};
  return {
    readdir: vi.fn(async () => {
      if (state.readdirFails) throw new Error("ENOENT");
      return teams;
    }),
    readFile: vi.fn(async (file: string) => {
      const entry = configs[teamFromPath(file)];
      if (!entry) throw new Error("ENOENT");
      return entry.json;
    }),
    stat: vi.fn(async (file: string) => {
      const entry = configs[teamFromPath(file)];
      if (!entry) throw new Error("ENOENT");
      return { mtimeMs: entry.mtimeMs };
    }),
  };
}

describe("scanTeamConfigs", () => {
  it("returns no diagnostics when teams directory does not exist", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/nope",
      fsImpl: makeFs({ readdirFails: true }),
      now: () => NOW,
    });
    expect(result).toEqual([]);
  });

  it("returns no diagnostics for a healthy team", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["good-team"],
        configs: {
          "good-team": {
            json: JSON.stringify({
              team_name: "good-team",
              members: [
                { name: "a", tmuxPaneId: "%1" },
                { name: "b", tmuxPaneId: "%2" },
              ],
            }),
            mtimeMs: NOW - 60_000, // 1 min old, fully spawned
          },
        },
      }),
      now: () => NOW,
    });
    expect(result).toEqual([]);
  });

  it("flags a partial-team config (member with empty tmuxPaneId past handshake window)", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["broken-team"],
        configs: {
          "broken-team": {
            json: JSON.stringify({
              team_name: "broken-team",
              members: [
                { name: "a", tmuxPaneId: "%1" },
                { name: "b", tmuxPaneId: "" },
                { name: "c", tmuxPaneId: "" },
              ],
            }),
            mtimeMs: NOW - 30 * 60_000, // 30 min old; way past handshake
          },
        },
      }),
      now: () => NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("partial-team");
    expect(result[0].teamName).toBe("broken-team");
    expect(result[0].detail).toContain("2 of 3");
  });

  it("does NOT flag a partial team during the spawn handshake window (mid-spawn is normal)", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["mid-spawn"],
        configs: {
          "mid-spawn": {
            json: JSON.stringify({
              members: [{ tmuxPaneId: "" }, { tmuxPaneId: "" }],
            }),
            mtimeMs: NOW - 30_000, // 30 sec old
          },
        },
      }),
      now: () => NOW,
    });
    expect(result).toEqual([]);
  });

  it("flags a stale config (no writes in > staleAfterMs)", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["sleeping"],
        configs: {
          "sleeping": {
            json: JSON.stringify({
              members: [{ tmuxPaneId: "%1" }],
            }),
            mtimeMs: NOW - 5 * 60 * 60 * 1000, // 5 hours stale
          },
        },
      }),
      now: () => NOW,
    });
    expect(result.some((d) => d.kind === "stale-config")).toBe(true);
  });

  it("flags malformed JSON (e.g. truncated write)", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["broken-json"],
        configs: {
          "broken-json": {
            json: "{not valid",
            mtimeMs: NOW - 60_000,
          },
        },
      }),
      now: () => NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("malformed");
  });

  it("can flag multiple kinds at once", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["doubly-broken"],
        configs: {
          "doubly-broken": {
            json: JSON.stringify({
              members: [{ tmuxPaneId: "" }],
            }),
            mtimeMs: NOW - 5 * 60 * 60 * 1000, // stale AND partial
          },
        },
      }),
      now: () => NOW,
    });
    const kinds = result.map((d) => d.kind);
    expect(kinds).toContain("partial-team");
    expect(kinds).toContain("stale-config");
  });

  it("skips directory entries without a config.json", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["no-config-here"],
        configs: {}, // none registered
      }),
      now: () => NOW,
    });
    expect(result).toEqual([]);
  });

  it("respects custom thresholds", async () => {
    const result = await scanTeamConfigs({
      teamsDir: "/fake",
      fsImpl: makeFs({
        teams: ["custom"],
        configs: {
          "custom": {
            json: JSON.stringify({ members: [{ tmuxPaneId: "" }] }),
            mtimeMs: NOW - 2 * 60_000, // 2 min old
          },
        },
      }),
      // Tighter handshake window — 1 min — so the 2-min-old config flags.
      spawnHandshakeWindowMs: 60_000,
      staleAfterMs: 24 * 60 * 60 * 1000,
      now: () => NOW,
    });
    expect(result.some((d) => d.kind === "partial-team")).toBe(true);
  });
});
