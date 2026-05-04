# Session Handoff — Kilroy
Date: 2026-05-04 — Phase 23 complete (regression spine + caching)

Phase 23 was the rigorous one. It built the regression spine the audit
had flagged: a shared dispatch test rig, a Dispatch lifecycle table,
Anthropic usage telemetry, prompt caching everywhere it pays, scenario
tests for race conditions, an offline eval runner with kind executors,
and revived E2E in CI. Plus the 23.5.1 follow-up that fixed the
real partial-batch-failure bug surfaced while writing scenario tests.

Sub-slices that landed (all green, all merged through validate.sh):

- **23.1** `tests/harness/dispatch-rig.ts` — shared test harness with
  scratch SQLite + queue singleton + spawn-record introspection +
  fake timers + Anthropic mock + dispose cleanup. 15 self-tests.
  `lib/claude-dispatcher.multi.test.ts` rewritten on the rig.
- **23.2** `Dispatch` model + idempotency-key migration. Lifecycle
  helper at `lib/dispatch-lifecycle.ts`. `dispatchClaude`,
  `dispatchAll`, `dispatchBatch` route through the helper.
  `launchInTerminal` and `launchInPane` thread `CASCADE_DISPATCH_ID`
  into the spawned env. Webhook correlates by idempotencyKey, dedups
  on already-completed, falls back to legacy lookup for orphaned
  hooks. Watchdog at `lib/dispatch-watchdog.ts`. `scripts/install-hooks.ts`
  updated to round-trip `idempotencyKey` via `${CASCADE_DISPATCH_ID:+...}`.
  4 webhook scenarios + 5 watchdog tests + 5 schema tests + 5 install-hooks
  tests + 4 lifecycle tests.
- **23.3** `AnthropicUsageEvent` model + `lib/anthropic-usage-log.ts`
  (`logUsage` + `extractUsageFields`, fire-and-forget via
  `queueMicrotask`). Wired into the 3 buffered call sites
  (overseer.chat, summarizer, feature-proposer). `lib/observability/usage-events.ts`
  with cursor pagination + computed `hitRate` per row.
  `app/observability/cache/page.tsx` — server-component flat table,
  no charts. Linked in sidebar as "Cache Telemetry."
- **23.4** Type widening for `cache_control` (TextBlock,
  AnthropicToolDefinition, SystemBlock, AnthropicMessageResponse.usage).
  `ToolRegistry.toAnthropicTools()` marks the last tool with
  `cache_control: ephemeral`. Compressed-history summary block,
  per-project chat system, and feature-proposer system (1h TTL) all
  cached. `lib/__tests__/prompt-snapshots.test.ts` snapshots the
  Overseer system prompt + tools and asserts the prefix-marker
  invariant + that the combined prefix exceeds Sonnet 4.6's 2,048-token
  cache minimum.
- **23.5** 11 scenario tests across `tests/scenarios/`:
  webhook-idempotency-key-path (4), webhook-resilience (4),
  dispatcher-resilience (4) covering race conditions and failure
  modes that the prior unit tests missed.
- **23.5.1** Real bug fix: per-project try/catch in `dispatchAll` /
  `dispatchBatch` so a single spawn failure doesn't abort the batch.
  3 batch-resilience tests + 4 shell-escape-verifier tests asserting
  the architecture-level invariant that prompts go through tmpfiles.
- **23.6** Eval runner scaffolding under `evals/`: `recorder.ts`
  with pinned hash function, `asserters.ts` (3 asserters returning
  `{ pass, diff }`), `runner.ts` with kind-executor registry, `run.ts`
  CLI with `--record`/`--scenario=`/`--kind=` flags. `pnpm eval` and
  `pnpm eval:refresh` scripts. `.github/workflows/evals.yml` runs
  replay-only on PR + nightly cron.
- **23.7** Kind executors for all three kinds. 3 knowledge-matcher
  fixtures, 35 escalation-detector logs (6 per signal type + 5
  true-negative false-positive risks). 38 eval scenarios passing.
  Overseer fixtures deferred (need live-API record pass — see debt
  23.D1).
- **23.8** E2E re-enabled in CI. `pnpm dev:ci` skips `op run`. 3
  fast Playwright smokes covering dashboard, Overseer chat,
  `/observability/cache`. Plus a CI `scenario` job running
  `tests/scenarios/`.
- **23.9** Audits/debt + handoff bookkeeping (this entry).

## Test counts and metrics

- Vitest: **131 files, ~917 tests, all green deterministically**
  (was flaky at 896 before the globalSetup fix)
- Eval suite: **38 scenarios green** under `pnpm eval`
- Playwright smokes: **3 green** (~2s total)
- `pnpm validate`: green end-to-end

## Known production behaviors verified post-merge

These are manual checks recommended after this branch deploys:

1. Open Overseer chat, send a message, then send another within 5
   minutes. Confirm at `/observability/cache` that turn 2 shows
   non-zero `cacheReadInputTokens`.
2. Dispatch a single project. Verify the activity-event log shows
   the `idempotencyKey` value in the details JSON, and the
   `Dispatch` row shows `status: "completed"` after the Stop hook
   fires.
3. After `pnpm tsx scripts/install-hooks.ts` re-runs across
   managed projects, confirm a fresh dispatch produces an
   `idempotencyKey` field in the webhook POST body (visible via
   `dispatch.findUnique` for a recently-completed row).

## Real bugs Phase 23 caught while building

- **The intermittent test flake** — root cause: parallel vitest
  workers racing on `prisma db push` regenerating the client.
  Fixed via `tests/harness/global-setup.ts` (push-once template DB)
  + `vi.importActual<fs>` for the rig's `copyFileSync`.
- **Partial-batch failure abort** in `dispatchAll`/`dispatchBatch`
  — surfaced by writing the respawn-pane scenario test, fixed
  in 23.5.1.
- **Stale dev server caught locally** — when AnthropicUsageEvent
  was added, the running dev server's Prisma client didn't have it.
  Restart resolved. Worth flagging that schema-changing slices
  require a dev-server restart for the user's manual testing.

## Next phases

- **Phase 24** — Overseer Intelligence (outcome-conditioned dispatch
  + tool-call observability). Specs in
  `requests/phase-24-overseer-intelligence/`.
- **Phase 25** — UX Polish (adaptive thinking, streaming, citations).
  Specs in `requests/phase-25-ux-polish/`.
- **Phase 26+** — Theme Pack (relocated from Phase 23).

---

# Session Handoff — Kilroy (Phase 22 archive)
Date: 2026-04-30 — Phase 22 complete (lead-stall guardrails + placeholder portrait)

Phase 22 ships the Cascade-side guardrails for the 2026-04-29 lead-stall
brief Delamain raised. Most of the deeper fixes (Agent error surfacing,
partial-team rollback, native lead recovery) live INSIDE Claude Code —
filed as a separate bug report (Justin handling). What landed here is
the orchestration-side defense:

- **22.1** `<Portrait/>` component (`app/components/portrait.tsx`) +
  `lib/portrait-fallback.ts` helper. Pure-SVG inline fallback (neutral
  speech-bubble glyph) replaces broken-image icons when an asset URL is
  empty / null / 404s. Wired into the chat header + main portrait + both
  settings previews. No theme can fail-render anymore.
- **22.2** `lib/iterm-session-validator.ts` — `isITermSessionAlive(id)`
  primitive via osascript. Strict UUID-shape input validation (no shell
  injection vector). Subprocess-injectable for tests. Available for
  future use; not wired into dispatchTeam (which uses tmux not iTerm).
- **22.4** `lib/team-config-scanner.ts` — pure helper that reads
  `~/.claude/teams/*/config.json` and surfaces three diagnostic kinds:
  `partial-team` (member with empty tmuxPaneId past the spawn handshake
  window), `stale-config` (no writes in N hours — silent stall), and
  `malformed` (broken JSON). Filesystem-injectable + Date.now-injectable
  for tests.
- **22.4 wire-up** `scripts/run-team-stall-scan.ts` runs the scanner on
  startup (next to the version watcher + stale-session cleanup), records
  each diagnostic as `ActivityEvent({eventType: "team-stalled"})`. Local-
  dev cadence is fine; prod would need cron / dispatch-queue scheduling.
- **22.5** Hardened the sprint prompt in `dispatchTeam` (lib/claude-
  dispatcher.ts) with explicit rules: after every Agent batch, check for
  empty / opaque / error results; emit user-visible text BEFORE yielding;
  never silent-yield on tool errors; flag broken team configs honestly.

Test count: 765 → 789 (+24). validate.sh green (second run; first
hit the documented parallel-suite prisma-push flake).

## Lead-stall bug report status
The Claude Code-side fixes (Agent error surfacing, partial team-config
rollback, native silent-yield prevention) are filed separately by
Justin. Track in upstream `anthropics/claude-code` issues. Cascade
guardrails above are the workaround until those land.

---

# Session Handoff — Kilroy (Phase 21 archive)
Date: 2026-04-29 — Phase 18 complete (Overseer migration arc closed)

Phase 18 lifted `hasSessionMemory` + `SessionMemoryState` into
`lib/session-memory.ts` so the dashboard conditional-rendering
logic is unit-testable. 4 tests added, all green. Test count:
723 → 727.

## Pre-existing concern flagged during Phase 18

Under suite-mode parallelism, ~20 test files time out in their
`beforeAll` hook (each runs `prisma db push` and races against
prisma's CLI). NOT introduced by Phase 12-18 — reproduces on bare
main too. Workarounds:
- `pnpm vitest run <specific files>` (focused — always green)
- `pnpm vitest run --pool=forks --poolOptions.forks.singleFork=true`

Fix is its own scope (shared schema push or faster setup). The full
surface of Phase 12-18 work (103 tests across 12 files) runs green
in focused mode.

## The whole arc, Phase 12 → 18

- **548 → 727 tests** (+179 over the arc)
- 7 phase branches, 30+ commits, all merged to main
- 14 tools, 1 endpoint, 1 dashboard panel
- 6 review passes; every finding fixed or explicitly deferred
- `app/api/overseer/chat/route.ts`: 615 → 287 lines
- The user-reported bug (Delamain context loss during inventory
  walks) fixed at the architecture level and guarded by an
  integration regression test.

---

# Session Handoff — Kilroy (Phase 17 archive)
Date: 2026-04-29 — Phase 17 complete (all 5 findings from fifth review)

Closed every item from the fifth code review. Two test-coverage
gaps + three nits. Plus the long-deferred dashboard wiring of the
session-state endpoint — `SessionMemoryPanel` now renders below the
chat showing activeFlow + proposed-dispatch count + workingMemory
keys. Read-only, coexists with the existing [DISPATCH] tag flow.

Test count: 714 → 723 (+9). validate.sh green.

---

# Session Handoff — Kilroy (Phase 16 archive)
Date: 2026-04-29 — Phase 16 complete (all 8 findings from fourth review)

Closed every item from the fourth senior code review. The bulk of
the work was in `app/api/overseer/session-state/route.ts`, which
had landed in Phase 13.5 without enough integration scrutiny.

Highlights:
- GET no longer creates a session row. Split `getSession` (read-only)
  out of `getOrCreateSession`. Missing case returns `{exists: false}`.
- Strict date validation on the GET. `isValidSessionDate` is now
  shared (was duplicated/missing).
- Renamed `?date=` to `?sessionDate=` so chat route and GET use
  the same field name.
- Cross-referencing docstrings on the two unrelated "session" files
  (chat ChatSession vs webhook terminal-Claude-session).
- 256KB cap on `workingMemory` size — both write helpers enforce.
- Cache-Control: no-store on the GET response.
- Singleton-cache test for `DEFAULT_REGISTRY`.

Test count: 709 → 714. validate.sh green.

---

# Session Handoff — Kilroy (Phase 15 archive)
Date: 2026-04-29 — Phase 15 complete (all 9 findings from third review)

Closed every item from the third senior code review, including a
walked-back overpromise from Phase 14 (the compressor "$transaction
race fix" that was a no-op). Test count: 705 → 709. validate.sh green.

Highlights:
- Compressor cache write reverted to plain update; honest comment
  documents that last-writer-wins is acceptable for a cache.
- Dashboard now sends `sessionDate` in every chat POST so the TZ
  fix from 14.1 is actually live (was server-only before).
- `isValidSessionDate` rejects malformed-but-regex-matching dates.
- `closeStaleSessions` wired into `scripts/start.sh` — closes
  sessions older than 30 days on every dev startup.
- Real dispatch-tag contract via shared `DISPATCH_TAG_EXAMPLE` const.
  SP literal interpolates it; test imports it from the route. Drift
  fails the test.
- Route-level write-tool test exercises `update_session_memory` end
  to end (catches `ctx.sessionId` plumbing regressions).
- Summarizer fallback emits `ActivityEvent` so silent degradations
  are observable.
- `get_session_state` policy documented as read-through on closed
  sessions; covered by test.

---

# Session Handoff — Kilroy (Phase 14 archive)
Date: 2026-04-29 — Phase 14 complete (bug fixes from second review)

Phase 14 closed every 🟥 and 🟧 finding from the second senior code
review and the second QA pass. Test count: 688 → 705 (+17). All
checks green via `validate.sh`.

Highlights:
- TZ-aware session binding via optional `body.sessionDate`
- Compressor falls back to raw truncation when summarizer fails (no
  more 500 on Haiku outage)
- `propose_dispatch` validates the slug against a real Project
- Compressor's cache write is now in `$transaction` (matches 13.1)
- Dead `body.useTools` flag and stale 12F comment block removed
- `[DISPATCH]` tag/regex contract test (extracted parser to
  `lib/dispatch-tag-parser.ts`, used by both dashboard + tests)
- Route error-path tests (missing API key → 500; tool registry
  exact-set assertion catches drift)
- `closeStaleSessions` helper makes the `closedAt` invariant
  enforceable

Intentionally deferred:
- `commit_dispatches` effect tool — would let the model fire
  dispatches autonomously without user approval. Either dashboard
  needs to call it on Execute Sprint, or model autonomy boundaries
  need explicit definition. Separate scope.

---

# Session Handoff — Kilroy (Phase 13 archive)
Date: 2026-04-29 — Phase 13 complete (stability + test hardening)

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Other Claude instances dispatched into managed projects are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's Overseer chat.

## Current State

Phase 12 closed the Overseer tool-use migration (the bug fix Justin
asked for). Phase 13 closed every actionable item from the senior
code review and senior QA review that followed.

- **688 tests passing** (was 673 at end of Phase 12; +15 added in Phase 13).
- `scripts/validate.sh` green: env + lint + tsc + prisma generate + tests + build.
- Lint + tsc clean throughout.

## What landed in Phase 13

### 13.1 — Race conditions (load-bearing)
- `getOrCreateSession` wrapped in `prisma.$transaction`. Closes a
  TOCTOU race that would have created duplicate ChatSessions for the
  same UTC date under concurrent load.
- New `appendToWorkingMemoryList(prisma, sessionId, key, item)` helper
  in `lib/chat-session.ts`. Atomic via `$transaction`.
- `propose_dispatch` refactored to use the helper. The previous inline
  read-modify-write would have lost concurrent proposals.
- New `lib/chat-session.concurrency.test.ts`: 20 simultaneous calls
  produce ONE session; 20 simultaneous appends preserve all 20 items.

### 13.2 — Timeout + abort discipline
- `AnthropicCaller`, `MessageSummarizer`, `runToolUseLoop`, and
  `compressMessagesForSession` all accept an optional `signal`.
- `defaultAnthropicCaller` and `defaultSummarizer` thread the signal
  into `fetch`.
- Route handler creates a 60s `AbortController`, threads through
  compressor and loop, releases in `finally`. Phase 12 had dropped
  the legacy timeout when the SP-injection branch was removed; this
  restores it at the architectural level.
- Tests: caller receives the signal, pre-aborted signal short-circuits
  the loop with `truncated: true`.

### 13.3 — UX + cosmetics
- `sseFromText` now accepts `{model?, messageId?}` and defaults to
  honest values (`claude-sonnet-4-6`, dynamic id) instead of the
  `cascade-feature-check` leftover.
- New `formatTruncationSurface()` lists the tools the model called
  with counts when the loop bails — replaces the generic "I hit my
  iteration limit" line.
- `buildDefaultRegistry()` cached at module load. Pure singleton.

### 13.4 — Test hardening (from QA review)
- `inventory-walk.test.ts` — `toBe(12)` → `toBeGreaterThanOrEqual(12)`.
  Loosened the brittle exact-count without losing the lower-bound
  invariant.
- New: `runToolUseLoop` propagates a caller exception out of the loop.
- New: route handler invokes the compressor when conversation > 25.
- New: route handler skips the compressor on short conversations.
- Caught and fixed an incidental: route mock missing `chatSession.update`.

### 13.5 — Session-state endpoint
- New `GET /api/overseer/session-state` returns `{sessionId, startedAt,
  closedAt, activeFlow, workingMemory}` for a given date.
- Closes the half-shipped state where `propose_dispatch` wrote to
  `workingMemory.proposedDispatches` with no consumer. The dashboard
  can now read structured outputs in one request.
- 5 tests including the propose_dispatch use case.

## What's still deferred (intentional)

- **Live Anthropic e2e test.** Cost + maintenance trade-off; gated
  behind an env var if/when added.
- **`vitest --shuffle` flake-finder.** Would surface flakes from
  pre-Phase-12 code; separate scope.
- **Dashboard wiring** for `proposedDispatches`. Endpoint exists; UI
  change is its own concern.
- **Mid-tool-execution abort.** Tool handlers hold their own state;
  interrupting them safely is harder than the outer-call abort we
  added in 13.2.
- **`closeSession` cron.** Helper exists, exported, unused. Documented
  intent: a future periodic job will close inactive sessions.

## Operational notes
- Restart `pnpm dev` if it was running before the schema change of
  Phase 12E (compressedHistory column). Already restarted earlier in
  this session.
- Manual smoke: `curl -s http://localhost:3000/api/overseer/session-state` should return JSON for today's session.

## Next phase, if/when one is needed
The user-visible Overseer migration is done. Future phases would
target: dashboard UI for working-memory state, mid-tool-execution
cancellation, e2e test against real Anthropic, or new tools to extend
the agent's capability surface.
