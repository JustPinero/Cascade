# Knowledge Base

This directory stores lessons harvested from your projects. It populates automatically through:

1. **Session harvesting** — Claude sessions tag lessons with `[LESSON]` in handoff.md
2. **Retroactive harvest** — Click "Harvest History" to extract lessons from project git history
3. **Scan pipeline** — Lessons are harvested during project scans

## Files

- `overseer-playbook.md` — Your dispatch rules (copy from `overseer-playbook.example.md`)
- `deployment-playbook/` — Generic deployment lessons (shared, not personal)
- `*.md` — Category-specific lessons (auto-generated, gitignored)

## Getting Started

```bash
cp knowledge/overseer-playbook.example.md knowledge/overseer-playbook.md
```

Edit the playbook with your testing, coding, and workflow preferences. These rules are injected into every Claude Code session the Overseer dispatches.
