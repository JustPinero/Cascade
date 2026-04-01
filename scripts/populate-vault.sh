#!/usr/bin/env bash
set -euo pipefail

# Populate the Cascade 1Password vault with all project secrets.
# Reads .env.local (or .env) from each project and creates one
# 1Password item per project.
#
# Usage: bash scripts/populate-vault.sh [--dry-run]

VAULT="Cascade"
PROJECTS_DIR="${PROJECTS_DIR:-$HOME/Desktop/projects}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN — no changes will be made ==="
fi

echo ""
echo "Scanning $PROJECTS_DIR for project secrets..."
echo ""

for dir in "$PROJECTS_DIR"/*/; do
  name=$(basename "$dir")

  # Find the best env file
  envfile=""
  if [ -f "$dir/.env.local" ]; then
    envfile="$dir/.env.local"
  elif [ -f "$dir/.env" ]; then
    envfile="$dir/.env"
  else
    continue
  fi

  # Extract KEY=VALUE pairs (skip comments, empty lines, and non-secret values)
  secrets=()
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue

    key="${line%%=*}"
    value="${line#*=}"

    # Remove surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    # Skip empty values and placeholder values
    [[ -z "$value" || "$value" == "your-"* || "$value" == "sk-ant-xxx"* ]] && continue

    # Skip non-secret config (localhost URLs, file paths, booleans)
    [[ "$value" =~ ^(http://localhost|127\.0\.0\.1|file:|\.\/|true|false|[0-9]+)$ ]] && continue

    secrets+=("${key}[password]=${value}")
  done < "$envfile"

  if [ ${#secrets[@]} -eq 0 ]; then
    continue
  fi

  echo "[$name] — ${#secrets[@]} secrets from $(basename $envfile)"

  if $DRY_RUN; then
    for s in "${secrets[@]}"; do
      echo "  ${s%%=*}"
    done
    continue
  fi

  # Check if item already exists
  existing=$(op item list --vault "$VAULT" --format json 2>/dev/null | grep -c "\"$name\"" || true)

  if [ "$existing" -gt 0 ]; then
    echo "  Item exists — updating..."
    # Get the item ID
    item_id=$(op item list --vault "$VAULT" --format json | python3 -c "
import json, sys
items = json.load(sys.stdin)
for item in items:
    if item['title'] == '$name':
        print(item['id'])
        break
" 2>/dev/null || true)

    if [ -n "$item_id" ]; then
      op item edit "$item_id" --vault "$VAULT" "${secrets[@]}" 2>/dev/null && \
        echo "  Updated successfully" || \
        echo "  Update failed — may need manual edit"
    fi
  else
    echo "  Creating new item..."
    op item create \
      --category="Secure Note" \
      --title="$name" \
      --vault="$VAULT" \
      "${secrets[@]}" 2>/dev/null && \
      echo "  Created successfully" || \
      echo "  Creation failed"
  fi

  echo ""
done

echo "=== Done ==="
if $DRY_RUN; then
  echo "Run without --dry-run to actually populate the vault."
fi
