# Architecture Decisions

## Stack
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 16 (App Router) | SSR for dashboard, server components for direct fs reads |
| Backend | Next.js API Routes | No separate backend needed; API routes handle fs scanning, shell execution |
| Language | TypeScript (strict mode) | Type safety across the full stack |
| Database | SQLite via Prisma 7 | Lightweight, file-based, no server needed, perfect for local-first app |
| Styling | Tailwind CSS 4 | Utility-first, CSS-based config (not tailwind.config.js) |
| AI | Anthropic Claude API | Sonnet for chat/dispatch, Haiku for briefing/harvest |
| Auth | None | Single-user local app |
| Hosting | localhost:3000 | Local dev server |
| Testing | Vitest + Playwright | Fast unit tests + real browser E2E |
| Package Manager | pnpm | Fast, disk-efficient |

## Key Integrations
- **Anthropic API** — Powers the Overseer chat (streaming SSE), morning briefings, retroactive harvest, project wizard
- **Claude Code CLI** — Dispatched to projects via tmux or Terminal for autonomous work
- **GitHub CLI (gh)** — Repo creation during project setup
- **1Password CLI (op)** — Optional secret management
- **Vercel/Railway APIs** — Optional deployment status monitoring

## Dispatch Architecture

```
User → Overseer Chat → [DISPATCH] tags parsed
  → Single project: Terminal window (macOS) or direct bash (Linux)
  → Multiple projects: /api/dispatch/batch → tmux grid (tiled panes)
  → Agent teams: /api/dispatch/team → lead Claude + teammates in tmux

Sessions run independently:
  Claude Code reads CLAUDE.md + handoff.md + requests/
  → Does work → Updates handoff.md
  → Session ends → Stop hook fires

Stop hook pipeline:
  1. Copies handoff.md → .claude/sessions/{timestamp}.md (session log)
  2. POSTs to /api/webhook/session-complete
  3. Webhook calls importSingleProject() → updates health, progress
  4. Escalation detector parses session log for signals:
     - [NEEDS ATTENTION] → health=blocked, desktop notification
     - [LESSON] → harvested into knowledge base
     - [HUMAN TODO] → auto-creates task on /tasks page
     - Test failures → logged as blocker
     - Phase completion → activity event
  5. DispatchOutcome created → links session result to dispatch
  6. Dashboard auto-refreshes on window focus
```

## Key Architectural Decisions
1. **File system is source of truth** — SQLite indexes and caches project data; actual project directories are canonical
2. **Event-driven, not polling** — Stop hooks fire on session end; no background polling for project changes
3. **Server components by default** — Only use "use client" when React state, effects, or event handlers are needed
4. **Incremental scanning** — importSingleProject() for webhook-triggered updates; full scan only on manual "Scan" button
5. **Knowledge in-repo** — Knowledge base structure lives in /knowledge; actual lessons are gitignored (populated per-user)
6. **SQLite at project root** — Database is `./dev.db`, derived from fs and can be rebuilt; gitignored
7. **Platform-aware dispatch** — detectPlatform() selects osascript (macOS) or tmux-direct (Linux/WSL2) launch method
8. **Overseer is customizable** — Name, portrait, personality stored in localStorage; defaults to "Overseer"
9. **Personal data never committed** — Playbook, lessons, sessions, channel, database all gitignored
