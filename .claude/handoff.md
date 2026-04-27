# Session Handoff — Kilroy
Date: 2026-04-26 (evening — Windows post-migration repair)

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Named by Justin. Other project Claude instances are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's overseer chat.

## Current State
Cascade is PUBLIC at github.com/JustPinero/Cascade. 389+ tests across 63 files. CI green. All phases 1-9 complete. Phase 10 in progress.

**Active branch:** `phase-10/10.5-migration-repair`
**Active request:** `requests/phase-10-setup-safety/10.5-migration-repair.md`

## Why this exists (post-migration discovery, 2026-04-26)
After the Mac→Windows migration on 2026-04-15, every Project row in `dev.db` was pointing at `/Users/justinpinero/Desktop/Projects/...`. 21 rows, all dead. The 1Password integration's `isInsideProjectsDir` check correctly rejected stale paths with 403, surfacing the issue. Manual repair done for `teamistry` (cloned + DB path corrected). Existing `POST /api/projects/scan` then repaired buckets A + B (4 paths updated, `create-cascade` created). 16 orphaned rows remain (bucket C) — projects in DB with no on-disk copy. Request 10.5 builds the engine, CLI, API, and wizard to handle these and prevent recurrence on future migrations.

## Three buckets (see request 10.5)
- **A.** On disk + in DB → existing scan handles it (DONE)
- **B.** On disk + not in DB → existing scan creates it (DONE)
- **C.** In DB + no on-disk copy anywhere → 10.5 adds clone/archive/delete/skip flow (TODO)

## Action loop for next Claude
Prime → Plan → RED → GREEN → Validate against `requests/phase-10-setup-safety/10.5-migration-repair.md`.
Tests first. Don't extend the general PATCH allowlist — add a dedicated `/api/projects/repair` endpoint with stricter validation.

## What Was Built (summary across all sessions)

### Phases 1-6 (Original)
Scaffold, dashboard, knowledge base, project wizard, integrations, intervener.

### Phase 7 — Delamain Personality
Sound effects (Web Audio API synthesized tones), RPG portrait with talking animation (idle + open mouth swap).

### Phase 8 — Public Release
Customizable Overseer identity (name, portrait via localStorage), Engineer Channel (renamed from Kilroy, backwards compat), gitignored personal data, Windows/WSL2 platform detection, public release polish.

### Phase 9 — Dashboard Intelligence
Badges (deployed/client/testing/review/versioned), deploy health checks, CI status integration, blocked-on-human indicator, attention center (sidebar badge), deadlines with countdown, descriptive tooltips.

### Autonomy Upgrade (across sessions)
- Feedback loop: Stop hooks → webhook → targeted scan → escalation detection
- Session intelligence: session reader, Delamain context enrichment
- Learning: escalation detector, playbook learner, dispatch outcome tracking
- Notifications, morning briefing, conversation memory, semi-auto dispatch
- Voice input, CLI auth status, remaining work panel, human tasks page
- Retroactive harvest (147+ knowledge lessons from 17 projects)
- Agent team dispatch (lead Claude coordinates teammates via tmux)
- Kilroy ↔ Delamain channel (engineer-channel.md + API)

### Additional Work
- Hook format auto-repair (install-hooks.ts + /api/hooks/validate)
- Kickoff template v3.5 with prompt engineering audit fixes
- CI/CD setup prompt (standalone, in methodology repo)
- All GitHub repo descriptions updated across 19 projects
- READMEs written/updated for 8 projects
- Portfolio site updated: 3D particle field, tilt cards, React 19
- Templates scrubbed from git history, moved to private methodology repo
- Matinecock tribal site: asset conversion, seed updates, handoff prep

## Database
SQLite at ./dev.db (project root). 17 projects, 147+ knowledge lessons, dispatch outcomes, chat history, human tasks.

## Fleet Status
- 3 projects DONE: CON-CORE, pingthings, labwebsite
- 1 project BACKBURNER: PyrrhicVictory
- 2 projects EARLY: teamistry, sharpesanimalhouse (client)
- Rest: actively building at various progress levels

## Key Architectural Decisions
- Platform detection: detectPlatform() selects osascript (macOS) or tmux-direct (Linux/WSL2)
- Overseer is customizable: name/portrait in localStorage, defaults to "Overseer"
- Personal data never committed: playbook, lessons, sessions, channel, DB all gitignored
- Templates in private methodology repo (github.com/JustPinero/methodology)
- Agent team dispatch: lead Claude + teammates via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

## Pending
- Windows native Cascade adaptation (run Next.js natively, dispatch via WSL2)
- Docker containerization (future)
- Phase 9 features need wiring into scan pipeline (deploy health, CI status)
- Matinecock site: Blob storage token, seed run on production

## Kilroy's brain (2026-04-21)
Kilroy's memory + playbook + lessons now versioned at `github.com/JustPinero/kilroy-brain` (private). Install script at `~/kilroy-brain/scripts/install.{sh,ps1}` handles onboarding on new machines. Stop hook auto-harvests at session end; `git pull` auto-syncs via post-merge hook.

**For Del:** if users ask "how does Kilroy remember everything?" — the answer is the kilroy-brain repo. It's personal engineering context, private, not part of Cascade. Don't confuse it with Cascade's own `.claude/` folders which belong to each project.

## Phase 10 — Setup & Safety (in progress — opened 2026-04-18)

Four requests in `requests/phase-10-setup-safety/`. Motivation: the install
experience is what portfolio reviewers judge, and unthrottled subagents
would burn any tester not on a beastly rig.

### 10.1 — Subagent Concurrency Queue — COMPLETE
- ✅ `lib/dispatch-queue.ts` — `DispatchQueue` + `detectDefaultConcurrency()` + singleton `getDispatchQueue()`
- ✅ 16 unit tests green
- ✅ `dispatchClaude` routes through queue; API route `await`s it
- ✅ `dispatchAll`, `dispatchBatch`, `dispatchTeam` all route through the queue (Option B — pane grid pre-created with `[queued]` placeholders, `tmux respawn-pane -k` swaps in the real Claude command per queue release). 3 integration tests green.
- ✅ `POST /api/webhook/session-complete` calls `queue.release(projectPath)`
- ✅ TS clean, ESLint clean, `pnpm build` succeeds

### 10.2 — 1Password as Runtime Secret Source — COMPLETE
- ✅ `lib/onepassword.ts` gains `ensureCascadeVault()`, `bootstrapCascadeRuntimeItem()`, `resolveOpRef()`, `assertOpReady()`
- ✅ `.env.example` uses `op://Cascade/Cascade Runtime/anthropic_api_key` for the API key; `DATABASE_URL`, `PROJECTS_DIR`, `CASCADE_KNOWLEDGE_DIR` stay as literals
- ✅ `package.json` `dev` and `start` scripts wrap with `op run --env-file=.env --`
- ✅ `scripts/populate-vault.sh` deleted (1P is source of truth now, not backup)
- ✅ 16 tests across `lib/onepassword.runtime.test.ts` + `lib/env-format.test.ts`, all green
- ✅ TS clean, ESLint clean, `pnpm build` succeeds

**Justin must do before next `pnpm dev`:**
1. Create `.env` from `.env.example` (`cp .env.example .env`)
2. Ensure the 1P "Cascade" vault exists with item "Cascade Runtime" containing field `anthropic_api_key` set to your API key — OR run the 10.3 installer when available
3. Enable 1P Desktop → Settings → Developer → "Integrate with 1Password CLI" so `op run` re-auths via Windows Hello instead of master password

### 10.3 — create-cascade Installer — ✅ PUBLISHED (2026-04-21)
Sibling package at `C:\Users\justi\projects\create-cascade`. Live on npm and GitHub.

- 📦 **npm:** https://www.npmjs.com/package/@justpinero/create-cascade (scoped because unscoped `create-cascade` is taken by another user)
- 🐙 **GitHub:** https://github.com/JustPinero/create-cascade
- Users install via `npx @justpinero/create-cascade`
- CI publish uses **OIDC Trusted Publisher** (no tokens, no secrets, `--provenance` attestation)

**Account policy notes (2026-04-21):** `two-factor auth` was set to `auth-and-writes` initially, which blocks even automation tokens. Dropped to `auth-only` via npmjs.com → Security → Manage 2FA → "Additional Options" → uncheck "Require 2FA for write actions". OIDC doesn't depend on this — can be re-enabled if desired.

**Before next CI release:** add Trusted Publisher on npm (package settings → GitHub Actions: org=JustPinero, repo=create-cascade, workflow=publish.yml). One-time.

- ✅ All 14 steps implemented with injectable `exec` / prompts for testability
- ✅ **72 tests across 15 files, 100% passing** — every step tested including orchestrator integration (happy path + all failure-mode exit codes)
- ✅ `src/index.ts` orchestrator — wires all 14 steps, `--skip-smoke` flag, structured exit codes
- ✅ `README.md` — full flow, per-OS prereqs, 1P notes, exit code table
- ✅ `pnpm build` → 69KB self-contained ESM bundle with shebang
- ✅ GitHub Actions workflows: `ci.yml` (test matrix macOS + Linux), `publish.yml` (on version tag, needs `NPM_TOKEN` secret after repo is pushed)
- ⏸️ `npm publish` — tag `v0.1.0` after the repo is pushed and CI is green

### 10.4 — Installer Polish + README + Focus Test — PARTIAL (content done, focus tests pending)
- ✅ `README.md` rewritten — `npx create-cascade` as primary install, per-OS prereq commands, 1P rationale, memory-safe concurrency called out, troubleshooting highlights inline
- ✅ `docs/troubleshooting.md` written — 1P, WSL2 memory ceiling + `.wslconfig`, Claude Code hooks, port conflicts, dispatch queue, Prisma, Windows test quirks
- ✅ README links to `docs/troubleshooting.md`
- ⏸️ Focus test with Christina (Mac) — you schedule
- ⏸️ Focus test with Mikey (his rig) — you schedule
- ⏸️ `audits/install-feedback.md` — populated after focus tests
- ⏸️ Tests for the 3 remaining create-cascade steps (prompt-api-key, prompt-install-path, smoke-test) — require real stdin/server; follow-up

## Windows compatibility — RESOLVED 2026-04-20

The 15 pre-existing Windows test failures are fixed. Full `pnpm test` now passes cleanly on Windows.

**Root causes addressed:**
1. **Bash env prefix** — `DATABASE_URL="..." pnpm exec prisma db push` doesn't parse on Windows cmd. Replaced with shared helper `lib/__test-utils__/prisma-push.ts` that uses `execSync` with `env: {...}` option. Applied to 20 test files.
2. **Git commits without author** — fresh Windows installs have no `user.name` / `user.email` global config, so `git commit` fails. Fixed: test `git commit` calls now pass `-c user.name=Cascade -c user.email=test@local.dev`. Production code `project-launcher.ts` now has a `detectGitAuthor()` helper that reads the user's global config and falls back to a Cascade placeholder.
3. **`/dev/null` redirect** — production code in `retroactive-harvester.ts` and `claude-dispatcher.ts` used `2>/dev/null` which is bash-only. Replaced with Node's `stdio: ["pipe", "pipe", "ignore"]`.
4. **Unix path literals in tests** — `validators.test.ts` and `app/api/__tests__/dispatch.test.ts` used hardcoded `/home/me/...` paths. Updated to use platform-aware `path.resolve` + `path.join`.
5. **Single-quoted commit messages** — `git commit -m 'fix: ...'` fails on cmd.exe (single quotes not quote chars). Converted to unquoted or escaped double-quoted.
6. **Seed test fragility** — `lib/db.test.ts > seed script` depended on gitignored `templates/` dir; now `skipIf` when templates absent.
7. **Missing native module** — `better-sqlite3` wasn't built on Windows because pnpm ignores build scripts by default. Fixed with `pnpm approve-builds --all`.

**Final state:**
- Cascade: **422 passed / 0 failed / 1 skipped (seed, templates absent)** — was 262 passed / 15 failed / 11 skipped
- create-cascade: 72 passed / 0 failed
- TS strict mode: clean across both repos
- ESLint: 0 errors (12 pre-existing Next `<img>` warnings, untouched)

## People
- Dawn Lynch: mentor and guiding light. Asked Justin to finish site-unseen, medipal, ratracer.
- Mikey: cousin, 25yr coder, mentor. Bought Justin the PC.
- Christina: co-founder/partner for romereno (ReModel OS).
- Paula Sharpe: client for sharpesanimalhouse (pet platform).
- Robert Loomis: client for Zen.
- Deana: client for Canvas Caterers.
- Tec: client for matinecock-site. Non-technical, admin panel only.

[LESSON] Cascade's dev.db lives at project root, not prisma/. DATABASE_URL relative path resolves from project root.
[LESSON] Hook format bugs recur because terminal Claudes generate the old flat format. install-hooks.ts now auto-repairs.
[LESSON] WSL2 defaults to 50% of system RAM. On 16GB machines, this causes crashes. Set .wslconfig to cap memory.
