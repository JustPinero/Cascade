# Session Handoff — Kilroy
Date: 2026-06-08 — Phases 28-30 complete (preflight UI, wt split-pane, sourcemap hunt)

Knocked out the three Phase-26 follow-ups in one go.

**Phase 28 — Preflight UI badge.** `GET /api/preflight` thinly wraps `checkDispatchPreflight()`. New `<PlatformBadge />` in the dashboard header fetches it on mount and renders the detected platform with a green dot when every required tool is on PATH, amber when something's missing (hover title lists the gaps). 6 new tests. Verified live on this box: `{platform:"windows", ok:true, missing:[], tools:{claude, wt.exe, bash all resolved}}`.

**Phase 29 — wt split-pane batch layout.** `dispatchAll` / `dispatchBatch` on Windows now open one named wt window with split panes instead of N independent tabs. `maybeCreatePaneGrid` returns `"<batch-name>:<index>"` targets where the batch name is `cascade-<timestamp>`; new `launchInWtBatch` spawns `wt -w <name> new-tab` (index 0, creates the window) or `wt -w <name> split-pane` (index > 0, adds a pane). Single dispatch unchanged. 4 new test scenarios. wt's default split direction gives a "stairs" layout — refining to a true grid is a future polish slice if asked.

**Phase 30 — sourcemap hunt.** Found the `[27.D1]` culprit: `convert-source-map`'s regex was matching the literal string `sourceMappingURL=data:application/json;base64,` inside `tsx/dist/register-D46fvsV_.cjs` (tsx's own code that *generates* sourcemap comments). The match's base64 content was JS source, JSON.parse threw, vitest's stack-trace processor surfaced the throw as an "unhandled error" that broke the exit code. Triggered specifically when `lib/template-seed.test.ts` fired ENOENT (templates/ is gitignored and absent on this box) and vitest walked the stack into tsx. Fix: tracked pnpm patch on `@vitest/utils@4.1.2` (`patches/@vitest__utils@4.1.2.patch`, wired via `pnpmPatchedDependencies`) wraps `extractSourcemapFromFile` in a try/catch. Separately, the template-seed test now skips when the default template file is absent. `pnpm test` exits 0 on Windows: 975 passing / 6 skipped / 0 failures.

## State

- Local + origin main: 4bae5f3 (Phase 29 merged); Phase 28 (222b390) and Phase 30 (this commit, pending merge).
- `pnpm test` Windows exit 0; type check clean; lint 4 pre-existing warnings; build green.
- Branch `phase-30-sourcemap-hunt` ready to merge.

---

Date: 2026-06-05 — Phase 27 complete (Windows test parity)

Phase 27 fixed every test failure the Windows host had at Phase 26 close. Suite is now 966 passing / 1 skipped / 0 failing — up from 945 passing at the start of the day. Three small root causes, three small fixes:

- **CRLF tripping a regex.** `lib/anthropic-features-md.ts` split `content` on `\n` and matched field lines with `(.*)$`. JS `.` doesn't consume `\r` and `$` only anchors before `\n`/EOS, so on a Windows checkout (autocrlf converted the seed `.md` to CRLF) every field line failed to match and `loadCatalogFromMd` silently returned zero features. Fix: normalize `\r\n → \n` at the top of `parseAnthropicFeaturesMd`. Recovered 6 tests (2 in features-md + 2 in feature-check + 2 in feature-check.audit).

- **Forward-slash-only path split.** `lib/team-config-scanner.test.ts:teamFromPath()` did `file.split("/")` to extract the team-name segment from a path built by `path.join`. On Windows `path.join` emits backslashes, so `split("/")` returned one element and every fixture lookup returned undefined. Fix: `split(/[/\\]/)`. Recovered 5 tests.

- **EBUSY on the test SQLite file.** `app/api/overseer/session-state/route.test.ts` used `fs.unlinkSync` for setup/teardown. On Windows, SQLite's native handle isn't fully released across `$disconnect()` boundaries, so a previous run's leftover db file fails to delete and the whole test file fails to load. Fix: `fs.rmSync(p, {force:true, maxRetries:10, retryDelay:100})` with a tolerant try/catch around teardown. Recovered the whole 7-test file (0 → 7).

Type check clean, lint clean (4 pre-existing warnings), build green.

## Known quirk logged as debt

`pnpm test` exits 1 on Windows even with 0 failures — vitest's internal source-map symbolicator throws on a malformed inline sourcemap somewhere in the dependency graph. Doesn't reproduce on Linux CI (ubuntu-latest), doesn't affect any test result. Logged as `[27.D1]` in `audits/debt.md` for a future "find the bad sourcemap" slice.

---

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
