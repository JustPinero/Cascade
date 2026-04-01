#!/usr/bin/env bash
set -euo pipefail

echo "=== Cascade — Restarting ==="

# Kill existing dev server
pkill -f "next dev" 2>/dev/null && echo "Killed old server" || echo "No server running"
sleep 2

# Ensure dependencies
pnpm exec prisma generate 2>/dev/null
pnpm exec prisma db push 2>/dev/null

echo "Starting dev server at http://localhost:3000"
pnpm dev
