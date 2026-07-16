# Request 42.1 — P0 Hardening from the Fable Review (2026-07-16)

Source: `audits/fable-review-2026-07-16.md` §P0. Five small, independently testable fixes. TDD each: red → green, commit per fix, `scripts/validate.sh` at the end.

## Acceptance Criteria → Tests (write these FIRST)

| # | Criterion | Test File | Test Name |
|---|-----------|-----------|-----------|
| 1 | Fresh SQLite DB gets `journal_mode=wal` + `synchronous=NORMAL` via boot helper | lib/db-pragmas.test.ts | "enables WAL and NORMAL synchronous" |
| 2 | Helper never throws (bad client → logged, boot continues) | lib/db-pragmas.test.ts | "swallows pragma failures" |
| 3 | `ingestSessionComplete` rejects `projectPath` outside PROJECTS_DIR before any FS/git/DB work | lib/webhook-ingest.test.ts | "rejects out-of-tree projectPath" |
| 4 | Webhook route 400s non-string `projectPath`/`idempotencyKey` | app/api/webhook/session-complete/route.test.ts | "400 on malformed payload types" |
| 5 | Chat route aborts the tool loop when the client disconnects (request.signal) | app/api/overseer/chat/abort-wiring.test.ts | "propagates request abort" |
| 6 | Dispatch closure only flips `queued→started` (0-row update ⇒ no spawn, slot released) | lib/dispatch-lifecycle.test.ts | "does not spawn timed-out/failed rows" |
| 7 | `expectedBy` recomputed from actual start time, not enqueue time | lib/dispatch-lifecycle.test.ts | "expectedBy anchored at start" |
| 8 | Watchdog does NOT flip a `started` row whose liveness probe shows recent activity; extends `expectedBy` instead | lib/dispatch-watchdog.test.ts | "extends live sessions instead of timing out" |
| 9 | Watchdog still times out rows with no recent activity | lib/dispatch-watchdog.test.ts | existing behavior preserved |
| 10 | API request carries `system` as block array with `cache_control` on last system block; no tool-level breakpoint | lib/overseer-tools tests | "caches system prefix" |
| 11 | Each loop iteration marks the last content block of the last message; stale message markers stripped; ≤4 breakpoints total | lib/overseer-tools tests | "rolling message breakpoint" |

## Non-goals (logged, not built)
- Webhook shared-secret auth → new debt item (needs fleet hook rollout; loopback bind + containment close the remote/path vectors now).
- Stride-based history compression (P1.1), double-dispatch guard (P1.3), tmux batch-kill guard (P1.4) — next phase.

## Also in scope
- `package.json` dev script binds `-H 127.0.0.1`.
- `references/prompt-caching.md` corrected (breakpoint render-order drift).
- Debt log updates: new [42.D1] shared-secret follow-up; [41.D3] scope amendment (scan+webhook paths).
