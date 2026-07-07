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
- **Claude Code CLI** — Dispatched to projects via Terminal.app (macOS) / tmux (Linux) / Windows Terminal (Windows) for autonomous work
- **GitHub CLI (gh)** — Repo creation during project setup
- **1Password CLI (op)** — Optional secret management
- **Vercel/Railway APIs** — Optional deployment status monitoring

## Dispatch Architecture

```
User → Overseer Chat → [DISPATCH] tags parsed
  → Single project: Terminal.app (macOS) | tmux (Linux) | new wt tab (Windows)
  → Multiple projects: /api/dispatch/batch → tmux grid panes (Mac/Linux) | one named wt window with split panes (Windows, Phase 29)
  → Agent teams: /api/dispatch/team → lead Claude + teammates in tmux (Mac/Linux only; Windows returns "not supported")

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
7. **Platform-aware dispatch** — `detectPlatform()` selects osascript+Terminal.app (macOS), tmux-direct (Linux/WSL2), or wt.exe + Git Bash (Windows; Phase 26). `lib/dispatch-preflight.ts` reports per-platform tool availability; the result is surfaced in the dashboard header via `<PlatformBadge />` (Phase 28). On Windows, batch dispatch (`dispatchAll`/`dispatchBatch`) opens **one named wt window with split panes** rather than N independent tabs — `wt -w cascade-<timestamp> new-tab` creates the window on the first job and `split-pane` adds panes for the rest (Phase 29). Single dispatch still uses `-w 0 new-tab`. See `knowledge/cascade-windows-dispatch.md` for the full flow.
8. **Overseer is customizable** — Name, portrait, personality stored in localStorage; defaults to "Overseer"
9. **Personal data never committed** — Playbook, lessons, sessions, channel, database all gitignored
10. **Upstream-feature awareness (phase 11.1)** — Cascade keeps a catalog of Claude / Claude Code features (`UpstreamFeature`) and a per-project ledger of which features each project uses (`ProjectFeatureUsage`). The `/anthropic-feature-update-check` slash command in the Overseer chat refreshes both. Catalog seed: `knowledge/anthropic-features.md`. Detectors: `lib/anthropic-feature-detectors.ts`. Audit + discovery: `lib/anthropic-feature-check.ts`. Stop-hook webhook re-audits the affected project after every session. The `[ANTHROPIC]` tag in handoffs is parallel to `[LESSON]` for harvesting candidates from sessions.

11. **Feature proposer (phase 11.2)** — for each project × detected gap pair, `lib/anthropic-feature-proposer.ts` calls Sonnet with the feature's integration recipe + the project's CLAUDE.md / settings.json contents and asks for a concrete file-by-file diff. Surfaced via `/anthropic-feature-propose [<slug>...]` in the Overseer chat. Diffs are rendered as Markdown in the SSE response — Cascade NEVER auto-applies; the user reviews and pastes into the target project's Claude Code session manually. Gap detection skips features without a `detector` (we can't propose what we can't verify). Cost control: `maxFeatures: 5` per project per call.

12. **Feature proposal persistence (phase 11.3)** — the `FeatureProposal` table stores Claude-drafted diffs for `(project, missing-feature)` pairs. Lifecycle: `proposed → accepted | rejected | applied` via `PATCH /api/feature-proposals/[id]`. Routes: `GET/POST /api/feature-proposals`, `GET/PATCH/DELETE /api/feature-proposals/[id]`. The Overseer can list / accept / reject proposals via the tool framework without re-running the proposer.

13. **Local-test exit-code parity (phase 30)** — `convert-source-map`'s regex falsely matches the literal string `sourceMappingURL=data:application/json;base64,` inside `tsx/dist/register-D46fvsV_.cjs` (tsx's own code that generates sourcemap comments). When vitest symbolicates a stack frame into that file, `JSON.parse` throws and the runner exits non-zero. Tracked pnpm patch on `@vitest/utils@4.1.2` (`patches/@vitest__utils@4.1.2.patch`, wired via `pnpmPatchedDependencies`) wraps the extractor in a try/catch. Doesn't reproduce on Linux CI; only affects local Windows exit codes. Also: `lib/template-seed.test.ts` now skips when `templates/web-app-v3.3.md` is absent (the directory is gitignored — per-user setup).

14. **Publish-safety & secret-hygiene audit (phase 41.3)** — `lib/publish-safety.ts` runs as part of fleet health (`computeHealth()` returns a `publishSafety` summary; project import persists it in `healthDetails`). Detects the 2026-07-07 history-rewrite incident class: (1) ephemeral session files tracked in git (`.claude/handoff.md`, `.claude/kilroy-channel.md`, `.claude/sessions/`, `.claude/settings.local.json`, non-example `.env*`); (2) secret patterns in tracked files (coqui-kickoff secret-scan set + postgres:// URLs with embedded passwords, `sbp_`, `sntrys_`); (3) credentials embedded in `.claude/settings.local.json` permission strings. Repo visibility comes from `gh repo view --json visibility` behind an injectable, cached probe — only invoked when findings exist; no-remote/unknown is treated as private; public repos escalate every finding to severity `high`. The audit is READ-ONLY against target repos, and secrets are redacted by construction (first 10 chars + ellipsis — raw values never cross into findings, DB rows, or logs). Findings escalate to HumanTasks idempotently via `syncPublishSafetyTasks()` during project import (one task per distinct finding; category `credential` for secrets, `review` for tracked ephemeral files; priority `high` when the repo is public).

15. **Hot-path query indexes (phase 31)** — `Project.lastActivityAt`, `Project.(status, lastActivityAt)`, `ActivityEvent.createdAt`, `ActivityEvent.(projectId, createdAt)`, `ChatMessage.(sessionDate, createdAt)`, `HumanTask.(status, priority, createdAt)`. Covers dashboard `ORDER BY lastActivityAt DESC`, activity-feed poll `ORDER BY createdAt DESC`, briefing `WHERE createdAt >= since`, overseer history `WHERE sessionDate ORDER BY createdAt ASC`, and `/api/tasks?status=pending` filtering. All XS-effort additions, biggest dashboard latency win in the 2026-06-09 audit.
