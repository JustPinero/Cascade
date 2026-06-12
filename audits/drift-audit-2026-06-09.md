# Drift Audit — 2026-06-09

Branch: `phase-10/10.5-migration-repair`. Scope: `references/` vs code, per skill procedure.

## 1. Schema drift (`references/schema.md` vs `prisma/schema.prisma`)

Schema has **17 models**. Doc covers 13. Walk:

| Model | Status | Detail |
|---|---|---|
| Project | DRIFT | Schema adds 5 fields not in docs: `businessStage`, `projectContext`, `completionCriteria`, `badges`, `deadline`. Relations list missing: `humanTasks`, `dispatchOutcomes`, `dispatches`, `featureUsages`, `featureProposals` |
| HumanTask | OK | — |
| KnowledgeLesson | OK | — |
| KickoffTemplate | OK | — |
| AuditSnapshot | OK | — |
| ActivityEvent | OK | — |
| DispatchOutcome | DRIFT | Schema adds `dispatchId` (Phase 23.2 link to Dispatch); not in docs |
| Dispatch | UNDOCUMENTED | Entire model (Phase 23.2 lifecycle row) missing from `schema.md` |
| ChatSession | DRIFT | Schema adds `compressedHistory` (Phase 12E); not in docs |
| ChatMessage | OK | — |
| Reminder | OK | — |
| UpstreamFeature | DRIFT | Doc lacks `proposals` relation; otherwise current |
| ProjectFeatureUsage | OK | — |
| FeatureProposal | UNDOCUMENTED | Phase 11.3 model missing entirely |
| ToolCallEvent | UNDOCUMENTED | Phase 24.2 model missing entirely |
| AnthropicUsageEvent | UNDOCUMENTED | Phase 23.3 model missing entirely |
| CascadeConfig | OK | — |

## 2. API contract drift

`references/api-contracts.md` exists but is severely outdated. 41 route files via Glob; doc names ~17. Status:

| Route | Status |
|---|---|
| `/api/activity` | UNDOCUMENTED |
| `/api/advisories/generate` | UNDOCUMENTED |
| `/api/attention` | UNDOCUMENTED |
| `/api/briefing` | UNDOCUMENTED |
| `/api/dispatch/all` | UNDOCUMENTED |
| `/api/dispatch/batch` | UNDOCUMENTED |
| `/api/dispatch/team` | UNDOCUMENTED |
| `/api/engineer-channel` | UNDOCUMENTED |
| `/api/feature-proposals` + `[id]` | UNDOCUMENTED (Phase 11.3) |
| `/api/hooks/validate` | UNDOCUMENTED |
| `/api/integrations/auth` | UNDOCUMENTED |
| `/api/kilroy-channel` | UNDOCUMENTED |
| `/api/knowledge/gaps` | UNDOCUMENTED |
| `/api/knowledge/harvest-history` | UNDOCUMENTED |
| `/api/overseer/history` | UNDOCUMENTED |
| `/api/playbook` + `/suggestions` | UNDOCUMENTED |
| `/api/preflight` | UNDOCUMENTED (Phase 28) |
| `/api/projects/[slug]/sessions` | UNDOCUMENTED |
| `/api/projects/[slug]/work` | UNDOCUMENTED |
| `/api/projects/[slug]/chat` | UNDOCUMENTED |
| `/api/projects/[slug]/dispatch` | UNDOCUMENTED |
| `/api/projects/launch` | UNDOCUMENTED |
| `/api/reminders` | UNDOCUMENTED |
| `/api/tasks` | UNDOCUMENTED |
| `/api/webhook/session-complete` | UNDOCUMENTED (called out in CLAUDE.md/architecture but no contract) |

Documented routes (projects, knowledge, reports, templates, integrations subset, overseer chat/session-state, wizard) match reality. HTTP-method coverage in doc is shallow — most entries name the route without request/response shape.

## 3. Architecture drift (`references/architecture.md`)

- Versions in doc (Next 16, Prisma 7, Tailwind 4, React 19) match `package.json` (next 16.2.2, prisma 7.6.0, tailwind 4, react 19.2.4). OK.
- Key files spot-check: `lib/claude-dispatcher.ts`, `lib/health-engine.ts`, `lib/progress-engine.ts`, `lib/escalation-detector.ts`, `lib/dispatch-preflight.ts`, `dev.db`, `scripts/validate.sh` all exist. OK.
- Decision #7 covers Phase 26 (wt.exe + preflight). Phases 28, 29, 30 NOT reflected:
  - Phase 28 preflight UI (`/api/preflight` + `<PlatformBadge />`) — no mention.
  - Phase 29 multi-pane wt layout (`-w <batchName> split-pane` grid for batch dispatch on Windows) — not in dispatch diagram, which still says "one wt tab per project".
  - Phase 30 sourcemap patch (`patches/@vitest__utils@4.1.2.patch` + `template-seed.test.ts` skip) — not mentioned; arguably tooling-trivia, but worth a one-liner.
- Decisions 10/11 (Phase 11.1/11.2) present; Phase 11.3 FeatureProposal persistence absent.
- Phase 10.5 migration-repair (current branch) not yet in architecture — expected, work-in-progress.

## 4. CLAUDE.md accuracy

- Commands: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm exec prisma db push` all valid against `package.json` scripts. OK.
- References imports: `references/architecture.md`, `references/schema.md`, `references/deployment-landmines.md` all exist. OK.
- Action Loop / TDD / Git Workflow sections still match observed practice (per-phase branching, request files in `requests/`, validate.sh present). OK.

## 5. Env var drift (`references/env-vars.md`)

Doc lists: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `VERCEL_TOKEN`, `RAILWAY_TOKEN`, `PROJECTS_DIR`, `CASCADE_KNOWLEDGE_DIR`.

Grep across codebase finds these additional vars in use, none documented:

- `CASCADE_DISPATCH_ID` — Phase 23.2, set on spawned sessions, read by Stop hook. **HIGH-VALUE undocumented.**
- `CASCADE_MAX_CONCURRENT_SUBAGENTS` — `lib/dispatch-queue.ts` queue-throttle env.
- `CASCADE_PORT` — `scripts/install-hooks.ts` (defaults 3000).
- `ANTHROPIC_FEATURE_SOURCES` — `lib/anthropic-feature-check.ts`.
- `NODE_OPTIONS` (Phase 26, `--use-system-ca` for TLS-intercept networks) — mentioned only in `knowledge/cascade-windows-dispatch.md`, not in env-vars ref.
- `NODE_ENV`, `CI` — standard, but used in app code (could be a "Standard runtime" subsection).
- `CASCADE_KNOWLEDGE_DIR` — documented but no codebase hit found; likely stale or referenced indirectly (verify before pruning).

## Top remediation candidates

1. Add `Dispatch`, `FeatureProposal`, `ToolCallEvent`, `AnthropicUsageEvent` to `references/schema.md` and reconcile Project field list.
2. Rewrite `references/api-contracts.md` — 24 routes undocumented; current file covers <half the surface.
3. Document `CASCADE_DISPATCH_ID`, `CASCADE_MAX_CONCURRENT_SUBAGENTS`, `NODE_OPTIONS`, `CASCADE_PORT`, `ANTHROPIC_FEATURE_SOURCES` in `references/env-vars.md`.
4. Append Phase 28/29/30 notes to `references/architecture.md` (preflight UI, multi-pane batch layout, vitest sourcemap patch).
