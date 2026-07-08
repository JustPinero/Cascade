# Technical Debt Log

## Open

### [41.D10] Pre-existing absolute-path formatter/lint hooks in 3 projects (cross-machine bug)
Surfaced during the 41.5 fleet webhook rollout (2026-07-07). CON-CORE, medipal, and romereno each have a PostToolUse formatter/lint hook in `.claude/settings.json` that hardcodes an absolute path, e.g. `cd /Users/justinpinero/Desktop/projects/CON-CORE && npx prettier --write …` (also medipal prettier, romereno eslint jsx-a11y). settings.json is tracked and synced, so these break on the Windows machine after a pull (path doesn't exist → formatter hook fails). NOT introduced by the webhook rollout (that hook is now portable `$HOME`-relative) — pre-existing in each project's own stack hooks.
- **Fix:** replace the absolute `cd` with `$PWD` (or drop the `cd` — the hook already runs in the project dir), per project. Verify the formatter still resolves its config from `$PWD` first. One tiny commit each.
- **Note:** likely more projects have similar hardcoded stack-hook paths; a sweep of all tracked settings.json for `/Users/` would find them. Low, but it's silent formatter loss on the second machine.

### [41.D1] webhook-spool rename-aside atomicity is narrower than the docstring claims
`lib/webhook-spool.ts:14-20,91-96` — a microsecond TOCTOU race: if a Stop-hook shell has opened its `>>` fd on the spool inode but not yet written when the drain renames→reads→unlinks that inode, the hook's line lands on the unlinked inode and is lost. Never realistically hits on a single dev box, but the "never lost" docstring overstates the guarantee. Fix when it matters: O_APPEND to a path re-resolved per write, or a lockfile around drain. Low.

### [41.D2] session-complete-hook.sh builds JSON by raw shell interpolation
`scripts/session-complete-hook.sh:37-39` — `payload="{\"projectPath\":\"${project_path}\",…}"`. A path containing `"` or `\` yields malformed JSON → webhook 400 → spooled → quarantined → ping silently dropped. Not reachable on Justin's forward-slash macOS/Linux/WSL paths, but unescaped. Fix: build the payload with `jq -n --arg`. Low.

### [41.D3] briefing re-parses ~/.claude.json once per project (perf)
`app/api/briefing/route.ts` calls `computeInfraVersion(p.path)` per project, and `readWorkspaceTrust` (lib/infra-version.ts) reads + `JSON.parse`s the entire (potentially large) `~/.claude.json` each time. N projects = N full parses of the same file on the briefing happy path. Fix: read/parse once and pass the trust map in. Low/perf.

### [41.D4] webhook-ingest signal-loop creates are unguarded
`lib/webhook-ingest.ts:186-221` — the HumanTask/ActivityEvent `prisma.*.create` calls in the signal loop aren't wrapped, unlike the DispatchOutcome/feature-audit writes. A transient DB error there throws AFTER the dispatch row is flipped to `completed`, so the retried spool entry dedups and that DispatchOutcome is permanently skipped. Loses an analytics row, not lifecycle state. Fix: wrap the signal-loop writes so they can't abort post-completion. Low.

### [41.D5] brain-sync slug collisions silently overwrite
`lib/brain-sync.ts:119` — two distinct lesson titles that slugify identically ("Fix: the bug!" vs "Fix the bug") write the same `<slug>.md`; the second overwrites the first in the brain mirror (canonical KnowledgeLesson DB row unaffected). Fix: disambiguate with a short content hash suffix on collision. Low.

### [41.D6] publish-safety reports one match per pattern per file
`lib/publish-safety.ts:126-128` — `pattern.regex.exec(text)` returns only the first hit, so a file with two different secrets matching the same pattern reports one. Detection completeness gap, not a leak. Fix: global-flag exec loop, dedup by redacted value. Low.

### [41.D7] webhook-ingest has no isolated unit test
The shared `ingestSessionComplete` module (the heart of 41.5) is exercised only indirectly — via the HTTP route test and the drain-path test. Every branch is reached, but there's no dedicated `lib/webhook-ingest.test.ts`. Add one so future refactors of the shared ingestion path have a direct contract. Low (coverage).

### [41.D8] webhook-spool missing/empty-spool branch untested
`lib/webhook-spool.ts:85` — the `if (!fs.existsSync(spoolPath)) return {...}` no-op path has no test, the one "nothing to drain" resilience edge left unexercised in a resilience module. Add the empty/missing-spool case. Low (coverage).

### [40.D1] `formatCountdown` floor race makes one deadline-utils test flaky
`lib/deadline-utils.test.ts:8` builds `new Date(Date.now() + 3*86400000)` then asserts `formatCountdown(...) === "3d left"`. `formatCountdown` reads `Date.now()` again, so `diffMs` is `3 days − ε`; `Math.floor` drops it to `2` whenever ≥1ms elapses between the two reads → intermittent "2d left" failure (observed once during Phase 40; passes on re-run). Timing race, not time-of-day. Fix options: (a) make the test pin a reference instant (`vi.useFakeTimers()` / inject `now`), or (b) have `formatCountdown` round toward the deadline. Natural to fold into P7 (deadline/staleness triage), which will touch this module anyway.

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


### [41.1-residual] Some rig test file(s) leak scratch DBs even on green runs
A fully passing `pnpm test` still leaves ~6 `test-rig-*.db` files in `prisma/` (2 worker pids, rigs #1-4 and #1-2 — some rig-using test path never reaches `dispose()`, or the worker is torn down first). The 41.1 startup sweep in `tests/harness/dispatch-rig.ts` removes them on the next run (mtime > 60s before process start), so accumulation is capped at one run's leakage. Follow-up if desired: bisect the 24 rig-using test files to find the non-disposing path, or add a globalSetup-time sweep so even back-to-back runs start clean.

### [36.A5] Overseer chat history persisted client-side, droppable mid-stream
Two fire-and-forget POSTs from the component; route persists nothing; closing the tab loses the assistant turn after server-side effects already fired. See design-review [36.A5]. Fix: persist server-side in the chat route.

### [36.A7] dispatchClaude lacks the readiness gate batch dispatch enforces
Blocked on dispatch-rig support for real temp project dirs (rig uses synthetic `/p/alpha` paths that would fail an fs readiness check). See design-review [36.A7].

## Resolved

### [41.D9] Fleet webhook-hook rollout cross-machine path portability — RESOLVED 2026-07-07 (fix-41.D9)
Option (a) landed. `buildWebhookCommand` now emits a `$HOME`-relative script reference (`bash "$HOME/.cascade/session-complete-hook.sh" "$PWD" <port> > /dev/null 2>&1 &`) — no absolute `/Users/...` path — so a committed, cross-machine-synced `settings.json` hook resolves on every machine (`$HOME` expands per-machine inside the double-quoted command). New `copyCanonicalScript({home?, sourcePath?})` (home/source injectable for tests) installs `scripts/session-complete-hook.sh` → `<home>/.cascade/session-complete-hook.sh`, overwriting so updates propagate, `chmod 0755`. `processProject` copies before writing project settings; `instrumentation.ts` copies on server boot (next to the spool-drain wiring), wrapped so a copy failure never throws into startup — a freshly-cloned machine self-heals. `isCascadeStopHook` still matches the new command (contains `session-complete`) so an old absolute/inline Cascade Stop hook is replaced in place, no duplicate entry. 6 acceptance tests in `scripts/install-hooks.test.ts`; suite 179 files / 1222 tests green; validate.sh passes. Fleet rollout (`install-hooks.ts` across all 22 projects) is now SAFE to run — NOT run in this fix.

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
