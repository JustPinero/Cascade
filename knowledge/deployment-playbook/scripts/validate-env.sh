#!/usr/bin/env bash
# ============================================================
# Environment Variable Validator
# ============================================================
# Checks that required env vars are set and properly formatted.
# Usage: ./scripts/validate-env.sh [.env.example path]
#
# Reads .env.example to determine required variables,
# then checks that each is set in the current environment
# (or in .env / .env.local).

set -euo pipefail

ENV_EXAMPLE="${1:-.env.example}"
ERRORS=0
WARNINGS=0

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Environment Variable Validation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$ENV_EXAMPLE" ]; then
  echo -e "${RED}ERROR: $ENV_EXAMPLE not found${NC}"
  exit 1
fi

# Load .env and .env.local if they exist (for local validation)
if [ -f ".env" ]; then
  set -a; source .env 2>/dev/null; set +a
fi
if [ -f ".env.local" ]; then
  set -a; source .env.local 2>/dev/null; set +a
fi

# Parse .env.example for variable names
while IFS= read -r line; do
  # Skip comments and empty lines
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue

  # Extract variable name
  VAR_NAME=$(echo "$line" | cut -d'=' -f1 | tr -d ' ')
  [[ -z "$VAR_NAME" ]] && continue

  # Check if variable is set
  VAR_VALUE="${!VAR_NAME:-}"

  if [ -z "$VAR_VALUE" ]; then
    echo -e "${RED}  MISSING: $VAR_NAME${NC}"
    ERRORS=$((ERRORS + 1))
    continue
  fi

  # Check for placeholder values
  if [[ "$VAR_VALUE" == *"your_"* ]] || [[ "$VAR_VALUE" == *"placeholder"* ]] || [[ "$VAR_VALUE" == *"CHANGE_ME"* ]]; then
    echo -e "${YELLOW}  PLACEHOLDER: $VAR_NAME (still has placeholder value)${NC}"
    WARNINGS=$((WARNINGS + 1))
    continue
  fi

  # Check for trailing whitespace/newlines
  if [[ "$VAR_VALUE" != "$(echo -n "$VAR_VALUE" | tr -d '\n\r')" ]]; then
    echo -e "${YELLOW}  WHITESPACE: $VAR_NAME has trailing whitespace or newline${NC}"
    WARNINGS=$((WARNINGS + 1))
    continue
  fi

  # Security checks
  if [[ "$VAR_NAME" == VITE_* ]] || [[ "$VAR_NAME" == NEXT_PUBLIC_* ]] || [[ "$VAR_NAME" == EXPO_PUBLIC_* ]]; then
    # Check if public vars contain secret-looking values
    if [[ "$VAR_VALUE" == sk-* ]] || [[ "$VAR_VALUE" == sk_live_* ]] || [[ "$VAR_VALUE" == ghp_* ]]; then
      echo -e "${RED}  EXPOSED SECRET: $VAR_NAME has a public prefix but contains a secret value${NC}"
      ERRORS=$((ERRORS + 1))
      continue
    fi
  fi

  echo -e "${GREEN}  OK: $VAR_NAME${NC}"
done < "$ENV_EXAMPLE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}  $ERRORS errors, $WARNINGS warnings${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
elif [ $WARNINGS -gt 0 ]; then
  echo -e "${YELLOW}  0 errors, $WARNINGS warnings${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo -e "${GREEN}  All environment variables valid${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi
