#!/usr/bin/env bash
set -euo pipefail

echo "=== Cascade Validation ==="

echo ""
echo "--- Environment Check ---"
bash scripts/validate-env.sh

echo ""
echo "--- Lint ---"
pnpm lint

echo ""
echo "--- Type Check ---"
pnpm exec tsc --noEmit

echo ""
echo "--- Prisma Generate ---"
pnpm exec prisma generate

echo ""
echo "--- Tests ---"
pnpm test

echo ""
echo "--- Build ---"
pnpm build

echo ""
echo "=== All checks passed ==="
