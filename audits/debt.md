# Technical Debt Log

## Open

### [23.D1] Overseer eval fixtures need live-API recordings
Phase 23.7 shipped the overseer-tool-sequence kind executor + scratch SQLite seeding, but **no Overseer fixture files** because authoring requires `pnpm eval:refresh` against the live Anthropic API to capture deterministic recordings. Knowledge-matcher (3) and escalation-detector (35) fixtures pass without API access.
- **Unblocks:** Phase 24's outcome-conditioned-dispatch eval scenarios; full PR-time AI regression coverage.
- **Action:** run `pnpm eval:refresh` with `ANTHROPIC_API_KEY` set, hand-curate Overseer fixture files for the 5 scenarios listed in the original 23.7 plan (inventory-walk-medipal, dispatch-after-stall, blocker-triage, knowledge-query, fleet-status-quick), tune asserters until live model behavior agrees, commit recordings + fixtures.

### [23.D2] dispatchTeam still on legacy queue path
Phase 23.2's lifecycle migration intentionally skipped `dispatchTeam`. The lead/teammate spawn model can't cleanly thread a single CASCADE_DISPATCH_ID through to N teammate sessions (env propagation creates webhook dedup collisions across projects). Per-project teammate Stop hooks still fire and produce DispatchOutcome rows via the legacy fallback, but team dispatches don't get watchdog protection or per-project Dispatch row tracking.
- **Action when needed:** dedicated slice. Likely involves generating per-project idempotency keys server-side after the lead spawns and reconciling teammate Stop hooks back to the lead's batch.

### [23.D3] Streaming usage logging for wizard + project chat
23.3 wired `logUsage` into the 3 buffered Anthropic call sites (Overseer chat, summarizer, feature proposer). The 2 streaming call sites (`/api/wizard/chat`, `/api/projects/[slug]/chat`) need a TransformStream wrapper that watches `message_delta` events and extracts `usage` mid-stream.
- **Lands cleanly with:** Phase 25.2 (streaming Overseer responses), which establishes the streaming-usage pattern for the codebase.

### [23.D4] Real-world session logs in escalation corpus
23.7's escalation-detector corpus is 35 synthetic logs. A future slice can sanitize 5-10 real session logs from Justin's fleet to catch patterns the synthetic corpus misses (regex over-matches, novel phrasing).
- **Action when desirable:** copy real logs from `~/projects/*/.claude/sessions/`, sanitize project names + paths, add to `evals/scenarios/escalation-signals/<subdir>/` with hand-labeled `expected.json`.

### [23.D5] Watchdog scheduling
`runDispatchWatchdog(prisma, queue)` is callable but not yet wired into a Next.js cron or scheduled script. Tests invoke it directly; production needs periodic invocation (e.g. every 5 min) to actually time out hung dispatches.
- **Action:** add to a scheduled-task runner (sibling to `scripts/run-team-stall-scan.ts`) or expose via an admin route that an external cron hits.

### [23.D6] Legacy webhook fallback removal
The webhook still falls back to "find latest session-launched activity event" when an idempotencyKey is unknown. Once production telemetry shows zero `orphaned-webhook` activity events for a sustained window, remove the fallback path from `app/api/webhook/session-complete/route.ts`.

### [Theme Pack] — relocated from Phase 23
Phase 22's plan called the Theme Pack registry "Phase 23." Phase 23 was redirected to the regression spine + caching work after the audit. Theme Pack moves to a later phase (TBD by user — likely 26 or after).

## Resolved

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
