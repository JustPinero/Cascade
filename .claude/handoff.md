# Session Handoff — Kilroy
Date: 2026-06-05 — Phase 26 complete (Windows dispatch)

Phase 26 was a platform-coverage slice. After Justin's Mac → Windows
migration on 2026-04-15, the dispatcher silently broke: the non-`darwin`
branch of `launchInTerminal` spawned a detached `bash` with
`stdio: "ignore"`, so Claude sessions either ran invisibly or not at
all. The Overseer reported success because the spawn call returned and
a Dispatch row was written. This was caught on the Windows host roughly
two months after the move, when Justin tried to continue work and
"Delamain thinks it's working but I don't see anything."

Phase 26 adds a first-class Windows code path. macOS and Linux/WSL
paths are byte-identical to pre-Phase-26 — every change keys off
`detectPlatform() === "windows"`.

## What landed

### 26.1 — Dispatch preflight
- `lib/dispatch-preflight.ts` — `checkDispatchPreflight({platform?, whichTool?})` returns `{platform, ok, missing[], tools{}}`. Required tools per platform: macOS `claude+osascript`, Linux `claude+tmux+bash`, Windows `claude+wt.exe+bash`.
- Default `whichTool` shells to `where.exe` on Windows, `which` everywhere else. Tests inject a fake `whichTool` so no subprocess fires.
- 7 tests in `lib/dispatch-preflight.test.ts`, all green.

### 26.2 — Dispatcher Windows branches
- `lib/claude-dispatcher.ts`: `launchInTerminal` gains a `"windows"` branch — `wt.exe -w 0 new-tab --title <project> --suppressApplicationTitle bash -c "<cmd>"`. Same Git Bash quoting + `KEY='val' cmd` env injection that already worked on macOS.
- `dispatchAll` and `dispatchBatch` route through new platform-aware shims: `maybeKillTmuxSession`, `maybeCreatePaneGrid`, `launchForJob`, `maybeFocusFirstPane`, `maybeAttachTmuxSession`. On Windows the tmux ops no-op and `launchForJob` calls `launchInTerminal` per project (one wt tab per project, no grid).
- `dispatchTeam` returns early on Windows: `{success: false, error: "Agent teams require tmux — not supported on Windows. Use single dispatch or 'Resume All' instead."}`. The teammate-mode flag is hard-coupled to tmux at the Claude Code binary level.
- 5 Windows tests in `lib/claude-dispatcher.windows.test.ts`, all green.

### 26.3 — Test fixups for non-Windows platforms
- `tests/scenarios/batch-resilience.test.ts`, `tests/scenarios/dispatcher-resilience.test.ts`, `lib/claude-dispatcher.multi.test.ts` — all now pin `vi.mock("./platform", () => ({detectPlatform: () => "linux"}))` so the tmux-flow scenarios they were written for still exercise the tmux path on a Windows host. The mock is the *only* change; the scenarios themselves are byte-identical.

### 26.4 — Knowledge + references
- `knowledge/cascade-windows-dispatch.md` — flow, required setup, gaps, and the underlying TLS / 1Password gotchas that came up during migration.
- `references/architecture.md` — three lines updated to mention Windows in the dispatch matrix and the preflight module.

## Validation
- `pnpm exec tsc --noEmit` clean.
- `pnpm lint` 0 errors, 4 warnings (all pre-existing).
- `pnpm build` succeeds.
- `pnpm test` — **955 passing, 11 failing, 1 skipped, 972 total** (up from 945 passing pre-Phase-26).
- The 11 remaining failures are all pre-existing Windows-platform issues that have nothing to do with the dispatcher. Logged as `[26.D1]` in `audits/debt.md` for a future Phase 27 "Windows test parity" slice. They split across: `app/api/overseer/session-state/route.test.ts` (file load), `lib/anthropic-features-md.test.ts` + downstream feature-check tests (CRLF/BOM tripping the md parser), `lib/team-config-scanner.test.ts` (path mismatch).

## Real-world fixes shipped alongside (not strictly Phase 26)

These came up during the Mac → Windows debugging that led into Phase 26 and were committed earlier in the same session before the phase-26 branch was cut:

- **`fix(briefing): stop auto-retry loop when /api/briefing returns 429`** (commit `613fa7b`, pushed to `main`). MorningBriefing's auto-generate effect re-fired on every loading=true→false cycle, hammering a rate-limited endpoint and visibly bouncing the dashboard between two render heights. Guarded with a ref so the auto-trigger fires at most once per mount.
- **Generated Prisma client refresh.** After the 56-commit catch-up pull, `app/generated/prisma/` was stale — only had 9 of 17 models, so `prisma.toolCallEvent.findMany()` was undefined. `rm -rf app/generated/prisma .next && pnpm exec prisma generate` resolved.
- **`NODE_OPTIONS=--use-system-ca` added to `.env`** so Node's `fetch` to `api.anthropic.com` succeeds through this network's TLS-intercepting root CA. Same root cause as the pnpm `UNABLE_TO_VERIFY_LEAF_SIGNATURE` warning.
- **Git identity set globally** (`Justin Piñero <justinpinero@gmail.com>`) — the Windows box had no git config since the Mac move.

## What's still deferred (intentional)

- **Multi-pane wt layout.** One tab per project ships first. Split-panes within a tab (`wt new-tab cmd \; split-pane cmd \;`) is a follow-up if Justin asks for the tmux-grid density.
- **UI surface for preflight.** No badge/indicator on the dashboard or settings page yet. `checkDispatchPreflight` is reachable from code and tests; UI is a follow-up.
- **Agent teams on Windows.** Blocked at the Claude Code binary level on `--teammate-mode tmux`. Revisit if upstream adds a non-tmux teammate mode.
- **Pre-existing Windows test failures.** Logged as `[26.D1]`. Scope is a separate slice; none touch shipped code.

## Operational notes

- Dev server: `pnpm dev` → http://localhost:3000. `op run --env-file=.env -- next dev --turbopack`. The `op run` requires 1Password CLI to be authenticated.
- Anthropic API: `ANTHROPIC_API_KEY` is loaded via `op run` from the `op://Cascade/Cascade Runtime/anthropic_api_key` secret reference. If you hit `[error] Anthropic API error: 400 …credit balance is too low`, top up at https://console.anthropic.com/settings/billing.
- The kilroy-channel.md was removed in Phase 23 cleanup. The handoff and audits/ are the two persistent surfaces.

## Next phase, if/when one is needed

Likely candidates by impact:

1. **Phase 27 — Windows test parity.** Fix the 5 files logged in `[26.D1]`. Mostly file-encoding and path-handling cleanup; under a day.
2. **Preflight UI.** Dashboard badge + settings-page detail panel that calls `checkDispatchPreflight` server-side and surfaces missing tools with install links. Tightens the "intelligently configure on install" goal from the Phase 26 conversation.
3. **Multi-pane wt layout.** If Justin wants tmux-density on Windows, build the `wt new-tab cmd \; split-pane cmd \;` chain into `launchForJob` for `dispatchAll`/`dispatchBatch` and treat it as Phase 26.5.
