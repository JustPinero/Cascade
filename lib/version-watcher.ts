import { execSync } from "child_process";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Phase 11.1 — version-change trigger.
 *
 * On startup (and on demand), check the local `claude --version`
 * against the value Cascade last recorded in CascadeConfig.
 *
 * - First run: record current version, no notification.
 * - Same version: no-op.
 * - Different version: record new version + emit a system
 *   ActivityEvent ("feature-check-needed") that the Overseer chat
 *   can surface as a system message.
 *
 * Never throws. If `claude` is not installed or the call fails,
 * returns a `noop` result with a reason; the rest of Cascade
 * continues normally.
 */

export type WatcherStatus = "noop" | "first-recorded" | "version-changed";

export interface VersionWatcherResult {
  status: WatcherStatus;
  currentVersion: string | null;
  previousVersion: string | null;
  reason?: string;
}

export interface VersionWatcherDeps {
  /** Override for tests; default runs `claude --version`. */
  readVersion?: () => string | null;
}

function defaultReadVersion(): string | null {
  try {
    const out = execSync("claude --version", {
      stdio: "pipe",
      timeout: 5000,
    })
      .toString()
      .trim();
    // Common shapes: "claude 1.2.3", "1.2.3 (claude-code)", just "1.2.3".
    // Pull the first semver-ish token; fall back to the whole string.
    const semverMatch = out.match(/\d+\.\d+\.\d+(?:[\w.\-+]*)?/);
    return semverMatch ? semverMatch[0] : out;
  } catch {
    return null;
  }
}

export async function checkClaudeCodeVersion(
  prisma: PrismaClient,
  deps: VersionWatcherDeps = {},
): Promise<VersionWatcherResult> {
  const readVersion = deps.readVersion ?? defaultReadVersion;
  const current = readVersion();

  if (!current) {
    return {
      status: "noop",
      currentVersion: null,
      previousVersion: null,
      reason: "claude --version not available",
    };
  }

  const config = await prisma.cascadeConfig.findUnique({ where: { id: 1 } });
  const previous = config?.lastSeenClaudeCodeVersion ?? null;

  if (previous === current) {
    return { status: "noop", currentVersion: current, previousVersion: previous };
  }

  // Persist the new version (single-row upsert).
  await prisma.cascadeConfig.upsert({
    where: { id: 1 },
    create: { id: 1, lastSeenClaudeCodeVersion: current },
    update: { lastSeenClaudeCodeVersion: current },
  });

  if (previous === null) {
    return {
      status: "first-recorded",
      currentVersion: current,
      previousVersion: null,
    };
  }

  // Emit a system notification ActivityEvent. This is the
  // surface the Overseer chat scans on load.
  try {
    await prisma.activityEvent.create({
      data: {
        eventType: "feature-check-needed",
        summary: `Claude Code updated: ${previous} → ${current}. Run /anthropic-feature-update-check when ready.`,
        details: JSON.stringify({
          previousVersion: previous,
          currentVersion: current,
        }),
      },
    });
  } catch (error) {
    // Notification failure must not bubble — log only.
    console.error(
      JSON.stringify({
        event: "version_notification_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  return {
    status: "version-changed",
    currentVersion: current,
    previousVersion: previous,
  };
}
