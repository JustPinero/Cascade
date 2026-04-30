/**
 * Phase 22.4 — startup scan for stalled / partial teams.
 *
 * Scans ~/.claude/teams/*\/config.json for the failure modes the
 * 2026-04-29 lead-stall exhibited: members with empty tmuxPaneId
 * past the spawn handshake window, configs untouched for hours,
 * malformed JSON.
 *
 * Each diagnostic becomes an `ActivityEvent({eventType:
 * "team-stalled"})` so it surfaces in the dashboard activity feed
 * for the user to triage.
 *
 * Wired into scripts/start.sh next to the stale-session cleanup.
 * Best-effort; never blocks startup.
 *
 * For long-running deployments, schedule this on a tick (cron or
 * dispatch-queue) — once-at-startup is fine for local dev where
 * pnpm dev restarts often.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

import { prisma } from "@/lib/db";
import { scanTeamConfigs } from "@/lib/team-config-scanner";

async function main(): Promise<void> {
  try {
    const diagnostics = await scanTeamConfigs();
    if (diagnostics.length === 0) return;

    console.log(
      `[team-stall-scan] found ${diagnostics.length} diagnostic(s):`
    );
    for (const d of diagnostics) {
      console.log(`  - [${d.kind}] ${d.teamName}: ${d.detail}`);
      try {
        await prisma.activityEvent.create({
          data: {
            eventType: "team-stalled",
            summary: `Team "${d.teamName}" — ${d.kind}`,
            details: JSON.stringify({
              kind: d.kind,
              teamName: d.teamName,
              configPath: d.configPath,
              detail: d.detail,
            }),
          },
        });
      } catch (err) {
        // Telemetry failure is non-fatal.
        console.warn(
          `[team-stall-scan] failed to record activity event: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  } catch (err) {
    console.warn(
      `[team-stall-scan] scan failed (non-fatal): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
