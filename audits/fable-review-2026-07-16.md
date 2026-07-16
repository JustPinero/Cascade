# Fable Deep Review — Cascade as a Personal Orchestration Service
Date: 2026-07-16 · Baseline: main @ b154cce (Phase 41 complete, 1222 tests green)
Method: five parallel evidence-based review agents (orchestration core, AI/API efficiency, data layer + engines, feedback loop, safety/security). Known debt [41.D1]–[41.D10] excluded from findings; scoping verified where adjacent.

## Verdict
The architecture is genuinely strong — the Dispatch-row lifecycle spine, single-path webhook ingestion, real usage telemetry, and the Phase 31 index discipline are better than most production orchestrators. The gaps cluster in four places: (1) the **webhook surface** trusts its callers, (2) the **concurrency/RAM guard** can be defeated on every long session, (3) the **prompt-cache placement is wrong**, making it the single largest recoverable API spend, and (4) the **safety model is aspirational** — `autonomyMode` exists in the schema but `--dangerously-skip-permissions` is unconditional.

---

## P0 — small diffs, outsized impact (fix first)

### P0.1 Webhook hardening (SEC)
- `app/api/webhook/session-complete/route.ts` + `lib/webhook-ingest.ts:65` — **no `isInsideProjectsDir` check on caller-supplied `projectPath`**; ingest runs `git rev-parse`/`git status` (`lib/scanner.ts:48-73`) in an arbitrary directory. Hostile `.git/config` (`core.fsmonitor`) = local code execution. One-line guard; the validator already exists (`lib/validators.ts:35` — and it's a good one: realpath-before-prefix).
- Dev server listens on all interfaces (`package.json:8` has no `-H 127.0.0.1`); route has no auth and no rate limit. Add loopback bind + a shared-secret header written by install-hooks.
- `idempotencyKey` cast without typeof check (`route.ts:39-42`) → 500 instead of 400.

### P0.2 Dispatch state machine: guarded transitions + liveness (ORCH H1+H2)
- `lib/dispatch-lifecycle.ts:74-77` — the dispatch closure flips rows to `started` **unconditionally**; timed-out/failed rows get resurrected and spawned. Fix: `updateMany({ where: { id, status: "queued" } })`, skip spawn on 0 rows, recompute `expectedBy` from actual start.
- `lib/dispatch-watchdog.ts:44-51` — at the 30-min `expectedBy` the watchdog **releases the queue slot with no liveness probe** while the Claude process may still be running. On the WSL2 box (cap 1–2, ~16GB) this stacks a second CLI process on top of a live 45-min session — the exact OOM the cap exists to prevent. Fix: probe session-log mtime / tmux pane before release; make `expectedBy` heartbeat-extendable.

### P0.3 Prompt-cache placement (COST — largest recoverable spend)
- `lib/overseer-tools.ts:180-189` — breakpoint on the last **tool** caches *tools only* (render order is tools → system → messages; the comment and `references/prompt-caching.md:15,110` have it backwards — doc drift item). The ~1.7K-token system prompt and the entire message history are re-billed on **every one of up to 8 loop iterations per user turn**.
- Fix: breakpoint on the system block (the `SystemBlock` array form already exists at `:93`; `route.ts:455` passes a plain string) + rolling breakpoint on the last message block per iteration. Verify via existing `AnthropicUsageEvent` telemetry.

### P0.4 Client-disconnect abort (COST)
- `app/api/overseer/chat/route.ts:309-310` — only a 60s wall timer aborts; `request.signal` is never wired. A closed tab keeps burning up to 8 Sonnet calls + the Haiku summarizer. Fix: `AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])`.

### P0.5 Enable WAL (DATA)
- `lib/db.ts:7-9` — dev.db runs `journal_mode=delete` (verified empirically), violating `.claude/rules/db.md`'s own "enable WAL" rule. Every webhook commit pays a journal create/fsync/delete; cross-process access hits `SQLITE_BUSY`. Fix: one boot-time `PRAGMA journal_mode=WAL` + `synchronous=NORMAL`.

---

## P1 — correctness/safety debt to schedule

1. **Quadratic re-summarization** — `lib/chat-history-compressor.ts:108-110`: strict-equality cache check never hits on the next turn; past 25 messages every turn pays a full-transcript Haiku call *before* first token. Fix: stride-based boundary + delta summarization. (COST/LATENCY)
2. **Spool replay parses the wrong session log** — `lib/webhook-ingest.ts:165`: spool entries carry no session identity; overnight-downtime replay reads whatever log is newest *now* → real `[NEEDS ATTENTION]` silently lost, outcome recorded against the wrong session. Hook should stamp the log filename/timestamp. (FEEDBACK — worst silent failure mode)
3. **No double-dispatch guard** — dispatch routes never check for an existing `queued/started` row per project (the accidental dedupe was deliberately removed in Phase 37 and never replaced) → two agents on one tree, violating the operator's own rule. Pre-flight check → 409 + explicit override. (ORCH H4)
4. **Batch dispatch kills the shared tmux session** — `lib/claude-dispatcher.ts:693,816,974` `kill-session -t delamain` first thing → SIGHUPs in-flight sessions from the previous batch; Stop hooks never fire; work lost. Refuse when in-flight rows exist, or per-batch session names (the Windows path already does this). (ORCH H3)
5. **`--dangerously-skip-permissions` unconditional** — `lib/claude-dispatcher.ts:24` + launch paths; `autonomyMode` stored but never consulted; no deny-list exists anywhere. Gate destructive ops; reserve full-skip for explicit per-project opt-in; tier client projects (romereno/sharpes/matinecock). (SEC H1 + M5)
6. **WSL env leak** — `claude-dispatcher.ts:329-334` Linux spawn inherits full `process.env` incl. the op-injected `ANTHROPIC_API_KEY` into every dispatched session (macOS path doesn't — silent platform divergence; the WSL box is the primary). Pass only `CASCADE_DISPATCH_ID` + PATH. (SEC M4)
7. **Spool poison-pills + quarantine black hole** — `lib/webhook-spool.ts:144-161` retries failures forever (no attempt count/backoff); quarantined lines (`:82,118-134`) are never read, surfaced, or counted anywhere. Add attempts→quarantine + an ActivityEvent and a briefing line for spool/quarantine depth. (FEEDBACK M3/M4)
8. **Team dispatch bypasses slot accounting** — 1 queue slot, 1+N processes (`claude-dispatcher.ts:1091-1098`); heaviest path, zero RAM accounting. Weight = team size, or cap team size by detected concurrency. (ORCH M1)
9. **Keyless-ping duplicates + wrong-slot release** — legacy path creates duplicate DispatchOutcomes/HumanTasks on double delivery (`webhook-ingest.ts:187-204,265-308`; dedup is conditional on keyed dispatches) and releases the *newest* in-flight slot (`:97-106`). Teams still emit keyless pings ([23.D2]). (ORCH M2/M3 + FEEDBACK 5)
10. **Escalation regex brittleness** — `lib/escalation-detector.ts:21-45`: case-sensitive, single-line (tag-on-own-line → empty-title HumanTask that swallows all future dedup), fires on instructional text in logs. Case-insensitive + capture-to-blank-line + non-empty title. (FEEDBACK M6)
11. **`lesson-harvested` event lies** — webhook logs the event but creates no KnowledgeLesson; harvester only reads audits/handoff and only runs manually. Session-log-only lessons never reach the brain. Wire the create or rename the event. (FEEDBACK M7)

## P2 — efficiency/hygiene
- Publish-safety reads **every tracked file** per health compute, sync, per project, per scan/webhook (`publish-safety.ts:303-317`) — cache by (path, mtime, size) or scope to risk-shaped files; also detective-only (gates no push path) and pattern-shallow (no GCP/Stripe-live/JWT/npmrc; one match per pattern per file).
- Sync `execSync`/`writeFileSync` on request paths (health-engine, scanner ×2 duplicate `git status`, dispatcher tmux calls) — copy the fleet-reconciler's async `execFile` pattern.
- `DispatchOutcome` has zero indexes; hottest query polled every 120s — add `@@index([completedAt])`, `@@index([projectSlug, completedAt])`.
- No retention story for append-only tables (ActivityEvent/ToolCallEvent/AnthropicUsageEvent) — piggyback a 90-day sweep on the watchdog tick.
- Serial tool execution in the loop (`overseer-tools.ts:316-318`) — `Promise.all` independent reads; no loop-level tool-result size cap (~16-32KB + truncation marker).
- `redacted_thinking` blocks dropped by the stream accumulator (`streaming-accumulator.ts:138-157`) → 400 risk mid-chain; pass unknown block types through verbatim.
- Trust-fence project-derived content (handoff/session logs/lessons) before it re-enters Overseer/dispatch prompts; human-gated dispatch already limits the loop, but continue-mode chains sessions with no human between.
- `op` secret values pass through argv (`onepassword.ts:219`) — stdin/template instead. Prompt temp-files leak on failed dispatches. Dead-hook detection ("sessions ran but no pings"). Boot-time schema-drift probe for the two-machine `db push` workflow. `/api/projects` over-fetches blobs + double project query. 5-min cache TTL vs bursty usage — consider `ttl: "1h"` after P0.3. Model ID literals duplicated across call sites.

## Doc drift to fix when touching
- `references/prompt-caching.md` teaches the wrong breakpoint placement (says last-tool covers system+tools).
- `references/dispatch-table.md:51-57` documents timeout as terminal; late webhook flips it to completed.
- [41.D3] scope amendment: the per-project `~/.claude.json` re-parse also hits scan + webhook paths (via `computeHealth` → `computeInfraVersion`), not just briefing. [41.D5] scope: the likelier collision is same-title-different-project (dedup key is (title, project) but brain file key is slug(title) alone); hash should cover source+content.

## What's genuinely excellent — do not churn
- **Dispatch lifecycle spine**: one helper for every entry point, `CASCADE_DISPATCH_ID` round-trip, boot reconciliation's queued-vs-started crash split.
- **Single ingestion path**: live POST and spool replay run identical code; layered idempotency for keyed dispatches (early dedup + `@unique dispatchId` backstop); orphaned-webhook surfacing.
- **Usage telemetry**: per-call-site `AnthropicUsageEvent` with correct cache counters from `message_delta`, fire-and-forget, correct pricing math — everything needed to verify the P0.3/P1.1 fixes already exists.
- **Adaptive-thinking correctness** (explicit opt-in, raised max_tokens, signature round-trip) and **no-retry-loop failure paths** (summarizer degrades, tool loop hard-capped, tool errors → is_error results).
- **fleet-reconciler.ts** is the model shell boundary (async execFile, arg arrays, timeboxed, never throws, machine-readable skip reasons) — hold the dispatcher/scanner to it.
- **Phase 31 index comments** naming the exact query each index serves.
- **Publish-safety redaction invariant** (only first10+"…" ever leaves the matcher) and **realpath-before-prefix path validation**.

## Suggested execution shape
P0 is one focused phase (~5 small, independently testable diffs; the webhook guard, WAL, and abort wiring are each ~1-5 lines). P1 items 1-4 are the next phase. Everything else rides normal phase work. TDD per repo convention; the usage telemetry gives before/after numbers for P0.3/P0.4/P1.1.
