# Design & Architecture Review — 2026-06-11

Fresh senior-level pass over architecture, code quality, and product direction,
run alongside Phase 35. Everything here is NEW relative to `audits/debt.md` and
the 2026-06-09 audit set. Items applied same-day are marked ✅; the rest are
prioritized recommendations.

## 1. Architecture findings

### [36.A1] Queue slots leak on the happy path — release depends entirely on the Stop-hook webhook (HIGH)
`enqueueWithDispatchRow` (`lib/dispatch-lifecycle.ts`) holds a queue slot from
enqueue until `release(jobId)`, but the spawn is fire-and-forget — the slot is
never released when the spawn completes. The only releasers are the
session-complete webhook and the watchdog. Consequences:
- A missing/misconfigured Stop hook, or a manually killed wt tab, pins the slot
  until the 30-min watchdog deadline. On a <16GB box (concurrency 1) that means
  **the whole fleet silently wedges**. (Phase 35's in-process watchdog now
  bounds this at ~5 min granularity + 30-min deadline, but the design smell
  stands.)
- The release key is `project.path` and must byte-match the `projectPath` the
  Stop hook POSTs. Windows casing / separator / trailing-slash differences
  silently no-op the release.
- Keying by path means two concurrent dispatches of one project collide on a
  single slot id (`Set<string>` can't hold two in-flight jobs per path).

**Recommended:** release the slot when the spawn returns (the queue gates
process-startup RAM spikes, not session lifetime), and key the queue by the
Dispatch `idempotencyKey` (already unique, already round-tripped by the hook).

### [36.A2] DispatchQueue is RAM-only with no boot reconciliation (MEDIUM)
On restart the in-memory queue is empty but the DB still has `queued`/`started`
Dispatch rows. Nothing reconciles them at boot. Phase 35's `predev` +
instrumentation watchdog now sweeps *expired* rows at startup, which covers the
common case — but rows inside their 30-min window after a crash still hold no
slot and will be flipped to `timeout` even if the session actually completed
while the server was down.

### [36.A3] Health/progress engines do serial, synchronous fs+git work per project (MEDIUM, scales with fleet size)
`computeProgress.countTestFiles` walks each project's whole tree per scan;
`computeHealth` shells out to git via `execSync` (blocks the event loop);
`importProjects` loops projects serially. Fine at 10 projects, minutes-long at
50. `getDirMtime` is shallow so the `since` incremental path under-detects
nested changes. Quick mitigations: skip `dist`/`build`/`.next`/`coverage` in
the walk, parallelize the import loop with bounded concurrency, or move git
calls to `execFile` (async).

### [36.A4] Filesystem regex inference is brittle and silently wrong (MEDIUM)
Debt counts, audit grades, and `[NEEDS ATTENTION]` are regex-matched from
markdown with no "couldn't parse" state — formatting drift silently degrades to
`healthy`/`idle`. Consider a structured sidecar (`.cascade/state.json` written
by the session at end) as the primary signal with regex as fallback.

### [36.A5] Overseer chat persistence is client-side, dual-write, droppable (MEDIUM)
`overseer-chat.tsx` fires two independent `.catch(() => {})` POSTs to
`/api/overseer/history`; the chat route itself persists nothing. Closing the
tab mid-stream loses the assistant turn even though server-side effects
(dispatches, reminders) already fired. Two parallel session abstractions
(`sessionDate`-keyed ChatMessage vs `ChatSession.workingMemory`) straddle a
half-finished migration. **Recommended:** persist server-side in the route, or
at minimum batch both turns into one ordered POST.

### [36.A6] `[DISPATCH]` text tag is a stringly-typed duplicate of `propose_dispatch` (MEDIUM)
The model emits both a tool call and a regex-parsed prose tag; a project name
containing `:` or `—` corrupts the client-side parse. Retire the tag once the
dashboard reads proposals from the tool-call record.

### [36.A7] `dispatchClaude` skips the readiness gate batch dispatch enforces (LOW)
Single dispatch can launch into a project with no CLAUDE.md/git — exactly what
`dispatchAll`/`dispatchBatch` refuse. Not fixed same-day because the dispatch
test rig uses synthetic paths (`/p/alpha`) that would fail a real fs readiness
check; needs rig support for temp project dirs first.

### [36.A8] `Project.autonomyMode` is stored but never read by the dispatcher (LOW)
The full/semi/manual dial is schema-only. See P6 below.

## 2. Code quality (top items)

- **[36.C1]** Env-prefix builder duplicated 4× and single-quote escaping 3× in
  `lib/claude-dispatcher.ts` — extract `shellEnvPrefix()` / `singleQuote()`.
- **[36.C2]** `dispatchAll` vs `dispatchBatch` ~90% identical — collapse into
  one `dispatchJobs()` with thin adapters.
- **[36.C3]** `lib/claude-dispatcher.ts` (1080+ LOC) does five jobs — split
  prompt-gen / tmux / wt / orchestration; the eight `maybe*` platform shims
  want to be a strategy object.
- **[36.C4]** ✅ Webhook outcome derivation deduped into `deriveOutcome()`
  (was copy-pasted in the Dispatch path and legacy fallback).
- **[36.C5]** ✅ `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true` hoisted to a single
  documented `SKIP_PERMISSIONS_ENV` constant (3 call sites).
- **[36.C6]** `getGitBranch`/`isGitDirty` implemented twice (`health-engine`,
  `scanner`); `exists()` three times — consolidate into `lib/git-status.ts`.
- **[36.C7]** `overseer-chat.tsx` (1100 LOC): reminder-regex and dispatch-tag
  extraction belong in tested `lib/` parsers, not inline JSX.

## 3. Claude/Anthropic integration (reviewed against the 2026-06 API surface)

- ✅ **[36.B1] Adaptive thinking was never actually enabled.** Phase 25 assumed
  Sonnet 4.6 thinks automatically; it doesn't — the request must carry
  `thinking: {type: "adaptive"}`. `runToolUseLoop` now sends it (round-trip
  plumbing existed since 25.1). `references/anthropic-extended-thinking.md`
  corrected.
- ✅ **[36.B2] `max_tokens` default raised 2048 → 16000** in the tool loop —
  thinking tokens count toward `max_tokens`, so 2048 could eat the entire
  visible reply.
- **Models are current.** `claude-sonnet-4-6` and `claude-haiku-4-5` remain
  active recommended models (June 2026). Upgrade options, costed per MTok in/out:
  Sonnet 4.6 $3/$15 (current) → Opus 4.8 $5/$25 (drop-in for the Overseer; same
  API surface caveats: no sampling params — Cascade sends none — and prefills
  already unused) → Fable 5 $10/$50 (NOT drop-in: always-on thinking, `refusal`
  stop reason must be handled, 30-day retention requirement). Recommendation:
  stay on Sonnet 4.6 for the tool loop; consider Opus 4.8 only if dispatch
  proposals feel shallow.
- **Worth adopting later:** mid-conversation system messages (beta) for the
  Overseer's per-turn context injection instead of rebuilding the system
  prompt; `count_tokens` for the compressor's threshold instead of char
  heuristics; structured outputs (`output_config.format`) to replace the
  `[DISPATCH]` tag parse ([36.A6]).

## 4. Product recommendations (prioritized)

- **P1 — Self-healing dispatch lifecycle (M).** [36.A1]+[36.A2] as one slice:
  slot-release-on-spawn, idempotencyKey-keyed queue, boot reconciliation, and a
  "fleet stalled — N slots stuck" banner. The single most valuable property for
  a solo operator: the fleet never silently wedges. (Phase 35 shipped the
  watchdog leg of this.)
- **P2 — Fleet status strip (S).** `/api/dispatch/status` exposing queue
  size + in-flight rows; always-visible "N running / M queued / K stuck"
  header.
- **P3 — Outcome-driven dispatch recommendations (M).** The DispatchOutcome
  data exists; surface "audit on X: 4 dispatches, 0 findings — switch to
  continue?" on the dashboard. Closes the stated feedback-loop vision.
- **P4 — Structured state sidecar (M).** `.cascade/state.json` contract written
  by sessions; regex becomes fallback ([36.A4]).
- **P5 — Knowledge injection into dispatch prompts (M).** Auto-include top
  relevant harvested lessons in `generatePrompt`; diff new [LESSON] tags
  against existing knowledge post-session.
- **P6 — Enforce `autonomyMode` (S).** manual → propose-only, semi → require
  Execute click, full → auto-dispatch eligible ([36.A8]).
- **P7 — Deadline/staleness triage in the briefing (S).** `Project.deadline`
  and `lastSessionEndedAt` have no consumers; the morning briefing should flag
  "due in 4 days, 30% done" and "idle 11 days."
- **P8 — Cost widget on the dashboard (S).** AnthropicUsageEvent already
  records everything; promote "today: $X, cache hit-rate Y%" out of the
  observability sub-page.

## 5. Applied same-day (this session)

| Change | Files |
|---|---|
| Phase 35 predev fix — `2>/dev/null` broke under cmd.exe; watchdog never ran via pnpm | `package.json` |
| [36.B1] adaptive thinking enabled + test | `lib/overseer-tools.ts`, `lib/overseer-tools.thinking.test.ts` |
| [36.B2] tool-loop max_tokens 2048 → 16000 + test | same |
| Reference doc correction | `references/anthropic-extended-thinking.md` |
| [36.C4] `deriveOutcome()` dedup | `app/api/webhook/session-complete/route.ts` |
| [36.C5] `SKIP_PERMISSIONS_ENV` constant | `lib/claude-dispatcher.ts` |
