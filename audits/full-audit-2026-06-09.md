# Full Audit — 2026-06-09

Branch: `main` (audits ran against working tree on `main` at `0a7442a`)
Stack: Next.js 16.2.2 (Turbopack) · Prisma 7.6.0 · SQLite · React 19 · Tailwind 4 · Vitest

## Headline

Codebase is **healthy with caveats**. Build is clean, type-check is clean, lint has 4 cosmetic warnings, suite runs 975 passing / 6 skipped / 0 failing on Windows. Phase 26-30 (Mac→Windows parity + UI surfacing) landed well and didn't break anything.

But three problems compounded under the sprint:

1. **One CRITICAL security finding** — shell injection via project name in the tmux placeholder cmd. Cheap fix, real exposure if a project name ever bypasses slug sanitization at the wizard layer. `lib/validators.ts` already exports the sanitizer needed.
2. **Documentation drift across 3 of 4 reference files.** 4 entire Prisma models undocumented, 24 of 41 API routes undocumented, 5 env vars undocumented. Phase 28/29/30 not reflected in architecture.md despite shipping today.
3. **HTTP-boundary test coverage gap.** Only 2 of 41 API routes have route-level tests. Lib coverage is excellent (~97%); request/response surface is essentially uncovered. The 1093-LOC `overseer-chat.tsx` has zero tests.

Two performance wins are XS-effort and would meaningfully reduce dashboard / activity-feed latency: missing Prisma indexes on `Project.lastActivityAt` and `ActivityEvent.createdAt + (projectId, createdAt)`.

## Severity-ranked action list

| # | Severity | Finding | Source | Effort | File:line |
|---|----------|---------|--------|--------|-----------|
| 1 | CRITICAL | Shell injection via project name in `queuedPlaceholderCmd` | bughunt C1 | XS (one line) | `lib/claude-dispatcher.ts:454` |
| 2 | HIGH | `deploy-monitor` external fetches have no timeout | bughunt H1 | XS | `lib/deploy-monitor.ts:23,82` |
| 3 | HIGH | Overseer chat client-side fetch has no AbortController | bughunt H2 | S | `app/components/overseer-chat.tsx:462` |
| 4 | HIGH | Add 4 missing models to `references/schema.md` (`Dispatch`, `FeatureProposal`, `ToolCallEvent`, `AnthropicUsageEvent`) | drift | M | `references/schema.md` |
| 5 | HIGH | Rewrite `references/api-contracts.md` — 24 of 41 routes undocumented | drift | L | `references/api-contracts.md` |
| 6 | HIGH | Add route-level tests for top-5 mutating routes (`webhook/session-complete`, `overseer/chat`, `dispatch/team`, `projects/[slug]/dispatch`, `projects/launch`) | test-audit #1 | M | new test files |
| 7 | HIGH | Add Prisma indexes: `Project.@@index([lastActivityAt])`, `ActivityEvent.@@index([createdAt])`, `@@index([projectId, createdAt])` | optimize #1-2 | XS | `prisma/schema.prisma` |
| 8 | MEDIUM | Unguarded `JSON.parse(lesson.tags)` in 2 knowledge pages | bughunt M1 | XS | `app/knowledge/page.tsx:197`, `app/knowledge/[category]/page.tsx:79` |
| 9 | MEDIUM | Rate-limiter `Map` is unbounded — slow memory leak | optimize #3 | XS | `lib/rate-limiter.ts:8` |
| 10 | MEDIUM | `JSON.parse` of LLM output unguarded | bughunt M2 | XS | `lib/anthropic-feature-check.ts:219` |
| 11 | MEDIUM | `reminder-widget` polling has no in-flight cleanup | bughunt M3 | XS | `app/components/reminder-widget.tsx:20-35` |
| 12 | MEDIUM | `/api/knowledge/search` fetches every lesson then filters in JS | optimize #4 | S | `app/api/knowledge/search/route.ts:23` |
| 13 | MEDIUM | `lib/dispatch-lifecycle.ts` (Phase 23.2 core path, 92 LOC) has no direct tests | test-audit #2 | M | `lib/dispatch-lifecycle.test.ts` (new) |
| 14 | MEDIUM | Document `CASCADE_DISPATCH_ID`, `CASCADE_MAX_CONCURRENT_SUBAGENTS`, `NODE_OPTIONS`, `CASCADE_PORT`, `ANTHROPIC_FEATURE_SOURCES` in env-vars ref | drift | S | `references/env-vars.md` |
| 15 | MEDIUM | Append Phase 28/29/30 to `references/architecture.md` | drift | XS | `references/architecture.md` |
| 16 | MEDIUM | `overseer-chat.tsx` (1093 LOC, zero tests) — at least one render-without-crash smoke | test-audit #4 | S | new test |
| 17 | MEDIUM | Empty-state + error paths in `report-generator.test.ts` (100% happy-path) | test-audit #3 | S | `lib/report-generator.test.ts` |
| 18 | LOW | `/api/knowledge` (full list) is unbounded — cap at 500 + Cache-Control | optimize #5 | XS | `app/api/knowledge/route.ts:6` |
| 19 | LOW | N+1 in `/api/briefing` — serial `getSessionLogs` per project | optimize | S | `app/api/briefing/route.ts:46-61` |
| 20 | LOW | Over-fetching: `findMany` returns `projectContext`/`completionCriteria` blobs unused | optimize | S | 3 routes |
| 21 | LOW | Compound indexes for `ChatMessage.@@index([sessionDate, createdAt])` and `HumanTask.@@index([status, priority, createdAt])` | optimize | XS | `prisma/schema.prisma` |
| 22 | LOW | Tighten 7 `.toBeTruthy()` assertions in libs | test-audit #5 | XS | various test files |
| 23 | LOW | Client-component bloat — pages do useEffect→fetch instead of server-component data fetching | optimize | L | 6 page files |

## Cross-cutting themes

### "Shipped fast, never wrote it down"
Phase 11.3, 12E, 23.2, 23.3, 24.2, 28, 29, 30 all landed code without updating the corresponding doc. The audits found this in three places at once (schema models, API routes, env vars). Each individual omission is small; cumulatively, the references are unreliable to a new reader (or future Kilroy instance after compaction).

### "Lib tests are great, boundary tests are missing"
97% of `lib/` has tests. 5% of `app/api/` has tests. The dispatcher's `lib` layer has 4 dedicated test files; the routes that gate it have 0. A bug at the route boundary (auth, validation, malformed payload, status code regression) would not be caught by current tests.

### "Hot paths have no indexes"
The two queries that run on every dashboard refresh and every activity-feed poll both scan the full table. Indexes are XS effort. This is the cheapest quality-of-life win in the entire audit.

## Recommended sprint shape

**Single-sitting hardening (~2-3 hours of focused work):**

- **Phase 31** — Security + indexes (#1, #7-#9, #10-#11). All XS-S effort, all backed by existing patterns. Closes the CRITICAL finding and three MEDIUM ones, plus the perf wins. Ship in one commit.
- **Phase 32** — Drift reconciliation (#4, #5, #14, #15). Documentation-only. Updates schema, api-contracts, env-vars, architecture refs. Tedious but mechanical.
- **Phase 33** — Route-boundary tests (#6, #13, #16). Reuses the harness pattern from `app/api/overseer/session-state/route.test.ts`. Higher effort; could split if time-bound.

The first phase is the only one with security implications. Doing it next is the natural call.

## Per-audit reports

- [Bug Hunt](./bughunt-2026-06-09.md) — 1 CRITICAL, 2 HIGH, 4 MEDIUM
- [Test Audit](./test-audit-2026-06-09.md) — coverage gaps in routes + the largest component
- [Optimize](./optimize-2026-06-09.md) — 5 quick wins (most are XS)
- [Drift Audit](./drift-audit-2026-06-09.md) — 4 undocumented models, 24 undocumented routes, 5 undocumented env vars

## Health rating

| Surface | Status | Notes |
|---------|--------|-------|
| Build | ✅ Green | Clean Turbopack build, .next/static ≈ 1.24 MB |
| Type check | ✅ Green | 0 errors |
| Lint | ✅ Green | 0 errors, 4 cosmetic warnings (pre-existing) |
| Test suite | ✅ Green | 975/0/6, exit 0 on Windows |
| Test boundary coverage | 🟥 Gap | 2 of 41 routes have route tests |
| Documentation | 🟥 Drift | 3 of 4 references behind shipped code |
| Performance | 🟨 Quick wins available | Missing indexes on hot paths |
| Security | 🟥 Critical finding open | C1 shell injection |

**Overall:** GOOD code, drifted artifacts. The recent Mac→Windows sprint left a documentation tail and exposed one real security bug. Three focused phases close every HIGH+ finding.
