#!/usr/bin/env bash
set -euo pipefail

errors=0

# Check required env vars
if [ ! -f .env.local ] && [ ! -f .env ]; then
  echo "WARNING: No .env.local or .env file found"
  echo "  Copy .env.example to .env.local and fill in values"
  errors=$((errors + 1))
fi

# Check for DATABASE_URL
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -f .env.local ]; then
    if ! grep -q "DATABASE_URL" .env.local; then
      echo "WARNING: DATABASE_URL not set in .env.local"
      errors=$((errors + 1))
    fi
  fi
fi

if [ $errors -gt 0 ]; then
  echo ""
  echo "$errors environment warning(s) found"
  echo "Some features may not work without proper configuration"
else
  echo "Environment OK"
fi

# Don't fail on warnings — just inform
exit 0
