#!/usr/bin/env bash
set -euo pipefail

echo "=== Cascade — Starting ==="

# Ensure dependencies
pnpm exec prisma generate 2>/dev/null
pnpm exec prisma db push 2>/dev/null

# Phase 11.1 — version-change watcher.
# Compares local `claude --version` against the last-seen value;
# emits a system ActivityEvent when it changes so the Overseer can
# nudge the user toward /anthropic-feature-update-check.
# Best-effort — never blocks startup.
pnpm exec tsx scripts/run-version-watcher.ts 2>/dev/null || true

# Phase 15 — close ChatSessions older than 30 days. Keeps the
# `closedAt = null` invariant meaningful instead of accumulating open
# rows forever. Best-effort — never blocks startup.
pnpm exec tsx scripts/run-stale-session-cleanup.ts 2>/dev/null || true

# Phase 22.4 — scan ~/.claude/teams/*/config.json for stalled or
# partial teams (the 2026-04-29 lead-stall failure mode). Records
# ActivityEvents for any diagnostics; surfaces in the dashboard.
# Best-effort — never blocks startup.
pnpm exec tsx scripts/run-team-stall-scan.ts 2>/dev/null || true

# Phase 23 follow-up P0.1 — flip Dispatch rows past their expectedBy
# deadline to "timeout" and release queue slots. Once-at-startup is
# enough for local dev; long-running deployments should add a 5-min
# cron entry calling this same script.
pnpm exec tsx scripts/run-dispatch-watchdog.ts 2>/dev/null || true

echo "Starting dev server at http://localhost:3000"
pnpm dev
