#!/usr/bin/env tsx
/**
 * Phase 11.1 — invoked by scripts/start.sh on every dev startup.
 *
 * Runs the Claude Code version watcher; if the local `claude --version`
 * has changed, persists the new value and emits a system notification.
 * Failure modes are quiet by design (return 0 always) so a flaky
 * `claude` install never blocks Cascade from starting.
 */
import { prisma } from "@/lib/db";
import { checkClaudeCodeVersion } from "@/lib/version-watcher";

(async () => {
  try {
    const result = await checkClaudeCodeVersion(prisma);
    if (result.status === "version-changed") {
      console.log(
        `[version-watcher] Claude Code: ${result.previousVersion} → ${result.currentVersion}. ` +
          `Run /anthropic-feature-update-check in Overseer chat when ready.`,
      );
    } else if (result.status === "first-recorded") {
      console.log(
        `[version-watcher] Recorded Claude Code version: ${result.currentVersion}`,
      );
    }
  } catch (error) {
    console.error(
      `[version-watcher] error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    await prisma.$disconnect();
  }
})();
