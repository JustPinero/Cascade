#!/usr/bin/env bash
set -euo pipefail

echo "=== Cascade — Starting ==="

# Ensure dependencies
pnpm exec prisma generate 2>/dev/null
pnpm exec prisma db push 2>/dev/null

echo "Starting dev server at http://localhost:3000"
pnpm dev
