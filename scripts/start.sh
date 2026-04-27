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

echo "Starting dev server at http://localhost:3000"
pnpm dev
