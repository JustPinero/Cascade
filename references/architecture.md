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

15. **Fleet reconciliation (phase 41.4)** — `lib/fleet-reconciler.ts` makes Cascade's DB picture of the fleet survive contact with reality. `reconcileProject(record, opts)` compares a `Project` row's `path`/`status` against filesystem + git and returns a typed, extensible `findings` array (not booleans — 41.7 builds on this): `path-missing` (dead DB path → critical), `path-casing` (DB casing differs from the on-disk truth on case-insensitive FS; resolved component-by-component via `readdir`, so subsequent checks run against the real path — notice), `dirty-tree` (uncommitted count; ≥100 files escalates notice→warning), `ahead-behind` (local branch vs its `<remote>/<branch>` counterpart), `unpushed-branch` (local branches with no counterpart or unpushed commits), and `status-drift` (a "settled" status — complete/deployed/archived — contradicted by dirty tree / unpushed / ahead-of-origin work). `reconcileFleet()` fans out concurrently and exposes `drifted` (findings-only) + `formatDriftSection()` for the briefing. Constraints by construction: READ-ONLY against project repos except a single timeboxed, failure-tolerant `git fetch` (offline/unreachable → compare against last-known refs with a `remote.reason`, never a throw); every shell-out uses `execFile` with an argument array (no DB/user input interpolated into command strings). `computeHealth(path, { reconcileRecord, reconcileOptions })` runs the reconciler alongside the publish-safety audit (mirrors decision 14) and returns an optional `reconciliation`; project import passes the existing DB row with `fetch:false` (scan-triggered, latency-sensitive) and persists a `reconciliation` summary in `healthDetails`. Surfaces: `POST /api/briefing` runs a fetch-enabled pass (5s box) and returns a `drift` payload + feeds the drift section to the model; `GET /api/reconciliation` (local-only, `fetch:false`) backs the dashboard `FleetDriftPanel` (count + per-project findings; renders nothing when consistent).

16. **Lesson sync to kilroy-brain (phase 41.6)** — `lib/brain-sync.ts#syncLessonToBrain` mirrors each harvested `[LESSON]` into the private brain repo so learnings cross machines (the gap that let two machines' handoffs diverge on 2026-07-07). `harvestKnowledge(prisma, brainSyncOptions?)` calls it right after each `KnowledgeLesson` DB create. One markdown file per lesson under `<brain>/playbook/lessons/`, kebab-case `slugify(title)` (punctuation/emoji stripped to a filesystem-safe slug; re-harvesting the same title updates the same file — dedup by slug, no duplicates), frontmatter carries source project + date + tags, body is the lesson content. Brain root resolves from env `KILROY_BRAIN_PATH` then `~/kilroy-brain`; a missing brain dir returns `{ written: false, reason: "missing-brain" }` and logs one line — harvest never fails on it. Cascade performs NO git operations (the module never imports `child_process`; the brain's own harvest.sh/manual flow owns commits) — enforced by a boundary test that mocks `child_process` and asserts zero exec/spawn calls.

17. **Infrastructure-version health dimension (phase 41.7)** — `lib/infra-version.ts#computeInfraVersion(projectPath, opts)` makes each project's infra state a first-class health signal, built on 41.4's findings-array plumbing. Three signals: (1) **plugin version** — reads `~/.claude/skills/coqui-kickoff/.claude-plugin/plugin.json` `version` (machine-level, same for all projects; `{ installed, version }`, missing → `not-installed`, never throws); (2) **migration state** — `v3.5-remnants` when a project-local `.claude/skills|agents|commands` entry SHADOWS an EXACT plugin-provided v3.5 name (skills: test-audit/bughunt/optimize/drift-audit/course-correction/coding-standards/session-handoff/pre-deploy; agents: audit-runner/code-reviewer/debugger; commands: run-audits/test-audit/bughunt/optimize/drift-audit/handoff/course-correct/phase-complete/ci-update/defer/activate/pre-deploy) OR a `session-context`/`secret-scan` hook command still wired into project `.claude/settings.json` (deep-walked) — remnants are kind-prefixed (`skill:bughunt`, `hook:secret-scan`); else `v4` when any project-local (custom-named, e.g. sharpes' `run-tests`) machinery is present, else `no-kickoff`; (3) **workspace trust** — `hasTrustDialogAccepted` for the project's absolute-path key in `~/.claude.json` → `accepted` (true) / `not-accepted` (false, the real hazard — untrusted workspaces silently ignore project allow-lists in dispatched sessions, observed on sharpes during migration) / `unknown` (entry or key absent, file unreadable — never guessed). All `~/.claude` reads are path-injectable: `opts.pluginJsonPath`/`opts.claudeConfigPath` → env `CASCADE_PLUGIN_JSON_PATH`/`CASCADE_CLAUDE_CONFIG_PATH` → real `~` defaults, so tests run purely on filesystem fixtures. `computeHealth()` always includes an `infraVersion` block (accepts `opts.infraOptions`); project import persists it in `healthDetails`. Surface: `POST /api/briefing` computes infra per project, returns `infra: { plugin, remnantProjects }` and feeds a "Projects with v3.5 machinery remnants" section to the model so a shadowing project is a morning flag.

18. **Hot-path query indexes (phase 31)** — `Project.lastActivityAt`, `Project.(status, lastActivityAt)`, `ActivityEvent.createdAt`, `ActivityEvent.(projectId, createdAt)`, `ChatMessage.(sessionDate, createdAt)`, `HumanTask.(status, priority, createdAt)`. Covers dashboard `ORDER BY lastActivityAt DESC`, activity-feed poll `ORDER BY createdAt DESC`, briefing `WHERE createdAt >= since`, overseer history `WHERE sessionDate ORDER BY createdAt ASC`, and `/api/tasks?status=pending` filtering. All XS-effort additions, biggest dashboard latency win in the 2026-06-09 audit.
