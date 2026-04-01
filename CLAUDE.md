# Cascade — Nerve Center for Multi-Project Orchestration
Local-first Next.js dashboard for monitoring, knowledge harvesting, and project creation.
Solo developer tool — cyberpunk/DBZ aesthetic.

## Stack & Commands
Next.js 14+ (App Router) | TypeScript strict | Tailwind CSS | Prisma + SQLite | Vitest + Playwright
- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm test` — run Vitest
- `pnpm lint` — run ESLint
- `pnpm exec tsc --noEmit` — type check
- `pnpm exec prisma db push` — sync schema to SQLite

## References
@import references/architecture.md
@import references/schema.md
@import references/deployment-landmines.md

## Action Loop
Every request follows: **Prime → Plan → Execute → Validate**
1. **Prime**: Read the request file in requests/. Check .claude/handoff.md for context. Check knowledge/ for existing solutions from other projects.
2. **Plan**: Identify files to create/modify. List tests to write. Confirm approach fits acceptance criteria.
3. **Execute**: Write code. Write tests. Run tests frequently (`pnpm test`). Commit at logical checkpoints.
4. **Validate**: Run `scripts/validate.sh` — this is the same script CI runs. Nothing should fail in CI that wasn't caught here. Verify every acceptance criterion. Update references/ if schema or API contracts changed.
If validate fails, fix before moving on. Never skip validation.
When blocked, log to audits/debt.md and continue with what's unblocked.
After completing a request, update .claude/handoff.md and state the next request number.

## Coding Standards
1. TypeScript strict — no `any`, no `@ts-ignore`, no `as unknown as`
2. Server components by default — `"use client"` only for useState/useEffect/event handlers/browser APIs
3. Prisma queries only in server components and API routes — never in client components
4. Tailwind for all styling — no inline styles, no CSS modules
5. All async operations properly awaited — no floating promises

## Testing
Write tests alongside code (TDD preferred for complex logic). Unit tests for services/utils. Integration tests for API routes. E2E with Playwright for critical flows. Target: every acceptance criterion has a corresponding test.

## Git Workflow
Branch per phase: `phase-N-description`. Commit after each logical unit of work. Commit message format: `type(scope): description` (feat, fix, refactor, test, docs, chore). PR per request when prWorkflowEnabled.

## Compaction
On context recovery, read: CLAUDE.md, .claude/handoff.md, the current request file from requests/, and audits/debt.md. This restores full working context.

## Definition of Done
A request is done when: all acceptance criteria met, all tests pass, `scripts/validate.sh` passes, references/ updated if needed, handoff.md updated, no new untracked debt introduced without logging it.

## Knowledge Base
Before solving novel problems, check knowledge/ for existing solutions from other projects. If you discover a reusable lesson, tag it with [LESSON] in your handoff notes for the harvester to pick up.
