## Test Audit Report — 2026-06-09

### Summary
- Total tests: 981 | Pass: 975 | Fail: 0 | Skipped: 6
- Test files: 147 passed, 1 skipped (148 total)
- API routes with tests: 2 / 41 (4.9%)
- Components with tests: 11 / 35 (31%)
- Lib services with tests: ~93 / 96 (97%)

### Coverage Gaps

#### API Routes (CRITICAL — systemic gap)
Only `app/api/overseer/session-state/route.ts` and `app/api/preflight/route.ts` have route-level tests. The other 39 routes have no HTTP-shape tests (validation, auth, error status codes, body parsing). Lib coverage of underlying logic exists for most, but request/response boundary is uncovered:

- [CRITICAL] `app/api/webhook/session-complete/route.ts` — the Stop-hook entry point for managed sessions. `lib/session-webhook.test.ts` covers helpers, but the route itself (auth header, idempotency key path, malformed payload) is untested.
- [CRITICAL] `app/api/overseer/chat/route.ts` — streaming AI chat dispatcher. Zero route tests; only tool registry pieces are covered.
- [CRITICAL] `app/api/dispatch/team/route.ts`, `dispatch/batch/route.ts`, `dispatch/all/route.ts`, `app/api/projects/[slug]/dispatch/route.ts` — multi-process spawn endpoints. Underlying dispatcher has lifecycle/queue/multi tests, but the routes that gate them are untested.
- [HIGH] `app/api/wizard/chat/route.ts`, `app/api/projects/[slug]/chat/route.ts` — streaming chat routes with no tests.
- [HIGH] `app/api/projects/launch/route.ts`, `app/api/projects/scan/route.ts`, `app/api/reports/generate/route.ts`, `app/api/knowledge/harvest/route.ts` — mutating endpoints with no route-level coverage.
- [HIGH] `app/api/integrations/{auth,deploy-status,github,onepassword}/route.ts` — external-integration boundary, untested.

#### Lib Services Without Tests
- [HIGH] `lib/dispatch-lifecycle.ts` (92 LOC) — wraps every dispatch entry point with queued→started→completed/failed state transitions. Phase 23.2 core path with zero direct tests. Indirectly covered by dispatcher tests, but failure transitions, idempotencyKey collisions, and watchdog-deadline edges are not asserted.
- [MEDIUM] `lib/observability/tool-call-events.ts` (84 LOC) — cursor-pagination query helper. Has sibling `usage-events.test.ts` for the mirror module but no tests of its own; pagination boundaries, filter combinations, and empty-result behavior untested.
- [LOW] `lib/file-utils.ts` (14 LOC) — trivial single-function helper, low priority.

#### Components Without Tests (non-trivial only)
- [HIGH] `app/components/overseer-chat.tsx` (**1093 LOC**) — by far the largest component in the codebase, the primary user-facing chat surface. Zero tests. Streaming render, tool-call rendering, error states, and history rehydration all uncovered.
- [MEDIUM] `app/components/command-panel.tsx` (228 LOC) — interactive command surface, untested.
- [MEDIUM] `app/components/reminder-widget.tsx` (132 LOC) — stateful widget, untested.
- [LOW] `dispatch-results.tsx` (101 LOC), `portrait.tsx` (105 LOC), `project-list.tsx` (93 LOC) — moderate logic.
- Skipped per audit rules (presentational): advisory-badge, attention-badge, category-overview, gap-suggestions, health-indicator, lesson-card, theme-provider.

### Test Quality Issues

- [QUALITY] `lib/claude-dispatcher.test.ts` — only 73 lines covering a **1077 LOC** module. Tests only `generatePrompt`. Spawning, env-var pass-through, exec failure handling, and process-cleanup are split across `claude-dispatcher.{lifecycle,queue,multi,windows}.test.ts` but the surface area-to-test ratio is still thin for the largest service file in the repo. No tests for `execSync` failure paths.
- [QUALITY] `lib/report-generator.test.ts:75-110` — happy-path only. No tests for empty project state (no audits, no events, no lessons), no test for the `lessonsByCategory` aggregation when categories are duplicated or absent, no test for malformed `tags` JSON.
- [QUALITY] `lib/health-engine.test.ts:171` — `expect(result.details.gitBranch).toBeTruthy()` should assert `"master"` or `"main"` literal. 7 total uses of `.toBeTruthy()` across `claude-dispatcher.multi`, `claude-dispatcher.queue`, `cli-auth`, `health-engine`, `scanner`, `retroactive-harvester` — most could be tightened to `.toBe(...)` or `.toMatch(/.../)`.
- [QUALITY] `vi.mock` density acceptable (52 occurrences across 18 files, mostly Anthropic SDK + `@/lib/db` substitution). No excessive mocking detected.
- [QUALITY] Snapshot usage is minimal (2 occurrences, both in `lib/__tests__/prompt-snapshots.test.ts` — intentional prompt-drift detection). No snapshot crutches.

### Test DB Hygiene
Excellent. No test references `./dev.db`. All DB-touching tests use scratch files at `prisma/test-*.db` via `lib/__test-utils__/prisma-push.ts`, cleaned in `beforeAll`/`afterAll`. `DATABASE_URL` passed via env to `prisma db push` for cross-platform correctness (Windows-safe). No leaked state observed.

### Recommendations
1. **Add route-level tests for the top-5 mutating routes** (`webhook/session-complete`, `overseer/chat`, `dispatch/team`, `projects/[slug]/dispatch`, `projects/launch`) — these are the highest-blast-radius endpoints with zero HTTP-boundary coverage. Pattern from `app/api/overseer/session-state/route.test.ts` is reusable.
2. **Test `lib/dispatch-lifecycle.ts` directly** — assert queued→started→failed transitions on spawn rejection, completed transition on webhook, timeout on expectedBy passing. This is Phase 23.2 single-source-of-truth code with no direct tests.
3. **Cover error paths in `report-generator`** — empty project, malformed tags JSON, missing audits. Currently 100% happy-path.
4. **Add a smoke test for `overseer-chat.tsx`** — even a single render-without-crash + tool-call-message-renders test would establish a baseline for the 1093-LOC component.
5. **Tighten 7 `.toBeTruthy()` assertions** to value-equality where the expected value is known.
