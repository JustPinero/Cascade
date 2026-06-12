# Technical Debt Log

## Open

### [23.D1] Overseer eval fixtures need live-API recordings
Phase 23.7 shipped the overseer-tool-sequence kind executor + scratch SQLite seeding, but **no Overseer fixture files** because authoring requires `pnpm eval:refresh` against the live Anthropic API to capture deterministic recordings. Knowledge-matcher (3) and escalation-detector (35) fixtures pass without API access.
- **Unblocks:** Phase 24's outcome-conditioned-dispatch eval scenarios; full PR-time AI regression coverage.
- **Action:** run `pnpm eval:refresh` with `ANTHROPIC_API_KEY` set, hand-curate Overseer fixture files for the 5 scenarios listed in the original 23.7 plan (inventory-walk-medipal, dispatch-after-stall, blocker-triage, knowledge-query, fleet-status-quick), tune asserters until live model behavior agrees, commit recordings + fixtures.

### [23.D2] dispatchTeam still on legacy queue path
Phase 23.2's lifecycle migration intentionally skipped `dispatchTeam`. The lead/teammate spawn model can't cleanly thread a single CASCADE_DISPATCH_ID through to N teammate sessions (env propagation creates webhook dedup collisions across projects). Per-project teammate Stop hooks still fire and produce DispatchOutcome rows via the legacy fallback, but team dispatches don't get watchdog protection or per-project Dispatch row tracking.
- **Action when needed:** dedicated slice. Likely involves generating per-project idempotency keys server-side after the lead spawns and reconciling teammate Stop hooks back to the lead's batch.

### [23.D4] Real-world session logs in escalation corpus
23.7's escalation-detector corpus is 35 synthetic logs. A future slice can sanitize 5-10 real session logs from Justin's fleet to catch patterns the synthetic corpus misses (regex over-matches, novel phrasing).
- **Action when desirable:** copy real logs from `~/projects/*/.claude/sessions/`, sanitize project names + paths, add to `evals/scenarios/escalation-signals/<subdir>/` with hand-labeled `expected.json`.

### [23.D6] Legacy webhook fallback removal
The webhook still falls back to "find latest session-launched activity event" when an idempotencyKey is unknown. Once production telemetry shows zero `orphaned-webhook` activity events for a sustained window, remove the fallback path from `app/api/webhook/session-complete/route.ts`.

### [Theme Pack] — relocated from Phase 23
Phase 22's plan called the Theme Pack registry "Phase 23." Phase 23 was redirected to the regression spine + caching work after the audit. Theme Pack moves to a later phase (TBD by user — likely 26 or after).

### [30.D2-residual] Remaining HTTP-boundary test gaps (defer to a future phase)
Phase 33 closed the top-5 priority routes from the original [30.D2] finding. Phase 34 added the OverseerChat smoke. The largest remaining gaps:
- **`app/api/overseer/chat/route.ts`** — TURNS OUT this has substantial coverage already in `route.feature-check.test.ts` / `route.feature-propose.test.ts` / `route.tools.test.ts` (24 tests across the three files). Audit overstated the gap. Deeper streaming-format tests would still be valuable but lower priority than originally rated.
- **`app/components/overseer-chat.tsx`** — Phase 34 covered the mount + history rehydration + input + settings smokes (5 tests). Streaming render, conversation mode, voice flow, dispatch-tag actions still uncovered — each is its own slice if Justin asks.
- 32 remaining routes are lower blast-radius (reads, simple CRUD). Tackle opportunistically when touching them for other reasons.


### [36.A5] Overseer chat history persisted client-side, droppable mid-stream
Two fire-and-forget POSTs from the component; route persists nothing; closing the tab loses the assistant turn after server-side effects already fired. See design-review [36.A5]. Fix: persist server-side in the chat route.

### [36.A7] dispatchClaude lacks the readiness gate batch dispatch enforces
Blocked on dispatch-rig support for real temp project dirs (rig uses synthetic `/p/alpha` paths that would fail an fs readiness check). See design-review [36.A7].

## Resolved

### [23.D5] Watchdog scheduling — RESOLVED 2026-06-11 (Phase 35)
`instrumentation.ts` starts the watchdog on a 5-minute in-process interval at server boot (`lib/dispatch-watchdog-runtime.ts`); the `predev` npm script sweeps once before `next dev`. Singleton-guarded across HMR; NODE_ENV=test no-op.

### [36.A1] Queue-slot release keyed by project.path — RESOLVED 2026-06-11 (Phase 37)
Queue jobs are now keyed by the Dispatch `idempotencyKey`: same-project dispatches hold distinct slots, and webhook/watchdog releases can't miss on path byte-differences. Key-less (legacy) hooks release the newest in-flight row's key as a fallback. Boot reconciliation (`reconcileOrphanedDispatches`) fails rows still `queued` at process start ([36.A2]). Deliberately NOT changed: a slot is still held for the session's lifetime — release-on-spawn would redefine what concurrency means (launch-rate vs running-sessions) and is a product decision; revisit if wanted.

### [30.D2] HTTP-boundary test gap (top-5 routes) — RESOLVED 2026-06-09 (Phase 33)
Top-5 mutating routes from the original audit finding now have route-level tests, plus `lib/dispatch-lifecycle.ts` (Phase 23.2 core path) has direct tests:
- `lib/dispatch-lifecycle.test.ts` (7 tests) — queued/started/failed transitions, idempotencyKey uniqueness, expectedBy honoring.
- `app/api/projects/launch/route.test.ts` (7 tests) — validation 400s, happy path, defaults, error surfaces.
- `app/api/projects/[slug]/dispatch/route.test.ts` (8 tests) — mode validation, slug 404, happy path with activity event + currentRequest write, rate-limit, custom-mode prompt threading.
- `app/api/dispatch/team/route.test.ts` (7 tests) — items validation, mode filter, happy path, rate-limit, Windows-error surfacing, 500 fallthrough.
- `app/api/webhook/session-complete/route.test.ts` (7 tests) — validation 400s, project-not-found writes orphan event (returns 200 by design), idempotency-key happy path + dedupe, legacy fallback.

36 new tests, suite at 1026 passing / 6 skipped / 0 failing. Residual gaps (overseer/chat, overseer-chat.tsx, 32 other routes) tracked above for opportunistic follow-up.

### [30.D3] Documentation drift across 3 of 4 references — RESOLVED 2026-06-09 (Phase 32)
- `references/schema.md`: added Phase 23.2 `Dispatch`, Phase 11.3 `FeatureProposal`, Phase 24.2 `ToolCallEvent`, Phase 23.3 `AnthropicUsageEvent`. Updated `Project` with 5 new fields (`businessStage`, `projectContext`, `completionCriteria`, `badges`, `deadline`) and 5 new relations. Added Phase 31 index notes on `Project`, `ActivityEvent`, `ChatMessage`, `HumanTask`. Added `DispatchOutcome.dispatchId`, `ChatSession.compressedHistory`, `UpstreamFeature.proposals` relation.
- `references/api-contracts.md`: rewritten end-to-end via the audit-runner agent. 58 entries across 12 groups covering every route under `app/api/**/route.ts`.
- `references/env-vars.md`: documented `CASCADE_DISPATCH_ID`, `CASCADE_MAX_CONCURRENT_SUBAGENTS`, `NODE_OPTIONS`, `CASCADE_PORT`, `ANTHROPIC_FEATURE_SOURCES`, plus a Runtime-set section for `CASCADE_DISPATCH_ID`/`NODE_ENV`/`CI`.
- `references/architecture.md`: dispatch diagram now reflects Phase 29 multi-pane wt layout; decision #7 covers `<PlatformBadge />` (Phase 28); new decisions #12 (feature proposal persistence, Phase 11.3), #13 (vitest source-map patch, Phase 30), #14 (hot-path indexes, Phase 31).

### [30.D1] CRITICAL shell injection via project name — RESOLVED 2026-06-09 (Phase 31)
`lib/claude-dispatcher.ts:queuedPlaceholderCmd` now calls `sanitizeForShell(projectName)` instead of stripping single-quotes only. `;`, `$()`, backticks, `\n`, and the other shell metachars are removed before the placeholder is interpolated into the tmux `execSync` call. Tests in `lib/claude-dispatcher.injection.test.ts` (6 scenarios) lock the invariant.

### [30.D4] Missing Prisma indexes on hot paths — RESOLVED 2026-06-09 (Phase 31)
Added: `Project.@@index([lastActivityAt])` + `@@index([status, lastActivityAt])`, `ActivityEvent.@@index([createdAt])` + `@@index([projectId, createdAt])`, `ChatMessage.@@index([sessionDate, createdAt])`, `HumanTask.@@index([status, priority, createdAt])`. Migrated via `prisma db push`. Dashboard / activity-feed / briefing / overseer-history queries now hit indexes instead of full-table scans.

### [30.D5] Rate-limiter Map unbounded — RESOLVED 2026-06-09 (Phase 31)
`lib/rate-limiter.ts` now sweeps expired entries when the store grows past 256 keys. O(n) walk, amortized to near-zero per call. Test asserts the store doesn't grow without bound under rotating-key traffic.

### [30.D6] Unguarded JSON.parse in knowledge pages — RESOLVED 2026-06-09 (Phase 31)
Extracted `parseLessonTags` into `lib/lesson-utils.ts`. Returns `[]` on malformed input, null/undefined, empty string, non-array shapes; coerces array members to strings. Applied at all three lesson surfaces (`app/knowledge/page.tsx`, `app/knowledge/[category]/page.tsx`, `app/knowledge/lesson/[id]/page.tsx`). The `anthropic-feature-check.ts:219` finding was a false positive — already wrapped in try/catch.

### [30.D7] Missing fetch timeouts — RESOLVED 2026-06-09 (Phase 31)
- `lib/deploy-monitor.ts` Vercel + Railway now use `AbortController` with a 10s watchdog; tests in `lib/deploy-monitor.test.ts` simulate hung remotes with fake timers.
- `app/components/overseer-chat.tsx` client-side `/api/overseer/chat` fetch now uses an `AbortController` with a 90s watchdog (server-side cap is 60s; 90s leaves margin for the SSE drain). Cleared in `finally`.

### [27.D1] Vitest source-map symbolicator throws on Windows — RESOLVED 2026-06-07 (Phase 30)
The trigger was `convert-source-map` matching the literal string `sourceMappingURL=data:application/json;base64,` inside `node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/register-D46fvsV_.cjs` — tsx's own code that *generates* sourcemap comments. The regex caught it as a real inline sourcemap and JSON-parsed the following JS, throwing `Unexpected token '�'`. Triggered specifically when `lib/template-seed.test.ts` fired a child-process ENOENT (templates/ is gitignored and absent on this Windows box) and vitest tried to symbolicate the stack walking into tsx. Fix: tracked pnpm patch on `@vitest/utils@4.1.2` that wraps `extractSourcemapFromFile` in a try/catch (committed at `patches/@vitest__utils@4.1.2.patch`, wired via `pnpmPatchedDependencies`). Separately, `lib/template-seed.test.ts` now skips when `templates/web-app-v3.3.md` is absent, so the underlying ENOENT no longer fires. `pnpm test` now exits 0 on Windows with 975 passing / 6 skipped / 0 failures.

### [25.D1] Overseer route streaming migration — RESOLVED 2026-05-04
`app/api/overseer/chat/route.ts` now uses `defaultStreamingAnthropicCaller`. The route synthesizes a single coherent SSE envelope to the client (one `message_start`, one text content block, one `message_stop`) regardless of how many Anthropic calls the tool-use loop makes. Tool_use events are hidden but a synthetic `tool_call_start` event is emitted for any UI progress indicator. Engineer-channel writeback runs after the stream closes; failures still don't affect the client. Route tests rewired to drain the SSE body before asserting side effects, and the test mock for `defaultStreamingAnthropicCaller` synthesizes per-block events so the route's `onEvent` handler exercises the same code paths it would with a live stream.

### [23.D3] Streaming usage logging for wizard + project chat — RESOLVED 2026-05-04
Phase 25.2 added a `pipeSseEvents` helper in `lib/overseer-tools-streaming.ts` and tee'd the Anthropic response in both `/api/wizard/chat` and `/api/projects/[slug]/chat`. The tap watches for `message_delta` events and calls `logUsage` with `callSite: "wizard"` or `"project.chat"` accordingly. Tap failures are caught and never break the client stream.

### [23.5.1] Partial-batch failure aborts subsequent projects — RESOLVED 2026-05-04
`dispatchAll` and `dispatchBatch` now wrap each per-project `enqueueWithDispatchRow` in a try/catch. Individual spawn failures push a failure entry into `results` and the loop continues. The lifecycle helper still marks the failed Dispatch row, the queue still releases the slot, but the rethrow no longer poisons the batch. `tests/scenarios/batch-resilience.test.ts` (3 tests) codifies the new behavior; `tests/scenarios/shell-escape-verifier.test.ts` (4 tests) asserts the architecture-level invariant that prompts go through tmpfiles, never inlined into shell commands.

### [10.1] Queue integration for multi-project dispatch — RESOLVED 2026-04-19
`dispatchAll`, `dispatchBatch`, and `dispatchTeam` now route through the
`DispatchQueue` singleton. Option B shipped: pane grid is created upfront
with "[queued: projectname]" placeholders, and `tmux respawn-pane -k`
replaces each placeholder with the real Claude command as the queue releases
slots. Users see the full grid immediately even on low-RAM hosts; Claude
processes are gated by memory-appropriate concurrency. `dispatchTeam`'s
single lead-agent spawn takes exactly one queue slot. 3 integration tests
in `lib/claude-dispatcher.multi.test.ts` verify enqueue counts + IDs.

**Open follow-up (smaller):** dashboard UI indicator for "N running, M queued"
so users can see queue state for multi-dispatch without looking at tmux.
Not urgent — tmux "[queued]" placeholders already communicate this at the
terminal level.
