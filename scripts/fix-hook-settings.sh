#!/usr/bin/env bash
set -euo pipefail

# Fix .claude/settings.json hook format across all projects.
# Transforms flat { matcher, command, description } entries into
# the correct { matcher, hooks: [{ type: "command", command, description }] } format.

PROJECTS_DIR="${PROJECTS_DIR:-$HOME/Desktop/projects}"

echo "Fixing .claude/settings.json hook format..."
echo ""

for dir in "$PROJECTS_DIR"/*/; do
  name=$(basename "$dir")
  settings="$dir.claude/settings.json"

  [ -f "$settings" ] || continue

  # Use python3 to transform the JSON
  python3 -c "
import json, sys

with open('$settings', 'r') as f:
    data = json.load(f)

if 'hooks' not in data:
    sys.exit(0)

changed = False
for event_type, entries in data['hooks'].items():
    if not isinstance(entries, list):
        continue
    new_entries = []
    for entry in entries:
        if 'command' in entry and 'hooks' not in entry:
            # Old format: { matcher, command, description }
            new_entry = {
                'matcher': entry.get('matcher', ''),
                'hooks': [{
                    'type': 'command',
                    'command': entry['command'],
                }]
            }
            if 'description' in entry:
                new_entry['hooks'][0]['description'] = entry['description']
            new_entries.append(new_entry)
            changed = True
        else:
            new_entries.append(entry)
    data['hooks'][event_type] = new_entries

if changed:
    with open('$settings', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print(f'  FIXED: {\"$name\"}')
else:
    print(f'  OK:    {\"$name\"} (already correct)')
" 2>&1 || echo "  ERROR: $name"

done

echo ""
echo "Done."
