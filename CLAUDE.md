# Cascade — AI-Powered Multi-Project Orchestration
Local-first Next.js dashboard with an AI dispatcher (the Overseer) that manages Claude Code sessions across projects. Features: fleet health monitoring, knowledge harvesting, session feedback loop, dispatch outcome tracking, morning briefings, conversation memory.

## Stack & Commands
Next.js 16 (App Router) | TypeScript strict | Tailwind CSS 4 | Prisma 7 + SQLite | Vitest + Playwright

## Key Architecture
- `app/api/overseer/chat/` — Overseer AI chat (Claude Sonnet, streaming)
- `app/api/webhook/session-complete/` — receives Stop hook pings from Claude sessions
- `lib/claude-dispatcher.ts` — dispatches Claude Code sessions (single, batch, agent teams)
- `lib/health-engine.ts` — computes project health from filesystem
- `lib/progress-engine.ts` — computes progress score (phases + tests + build readiness)
- `lib/escalation-detector.ts` — parses session logs for [NEEDS ATTENTION], [LESSON], [HUMAN TODO]
- SQLite DB at `./dev.db` (project root, NOT prisma/)
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
Every request follows: **Prime → Plan → Red → Green → Validate**
1. **Prime**: Read the request file in requests/. Check .claude/handoff.md for context. Check knowledge/ for existing solutions.
2. **Plan**: Identify files to create/modify. Map each acceptance criterion to a specific test. Confirm approach.
3. **Red (write failing tests)**: Write tests for EVERY acceptance criterion BEFORE writing implementation code. Run `pnpm test` — they should FAIL. This is your contract for "done."
4. **Green (implement until tests pass)**: Write code until all tests pass. Run tests frequently. Commit at logical checkpoints.
5. **Validate**: Run `scripts/validate.sh` — this is the same script CI runs. Nothing should fail in CI that wasn't caught here. Verify every acceptance criterion has a passing test. Update references/ if schema or API contracts changed.
If validate fails, fix before moving on. Never skip validation.
When blocked, log to audits/debt.md and continue with what's unblocked.
After completing a request, update .claude/handoff.md and state the next request number.

## Coding Standards
1. TypeScript strict — no `any`, no `@ts-ignore`, no `as unknown as`
2. Server components by default — `"use client"` only for useState/useEffect/event handlers/browser APIs
3. Prisma queries only in server components and API routes — never in client components
4. Tailwind for all styling — no inline styles, no CSS modules
5. All async operations properly awaited — no floating promises

## Testing Protocol (TDD — NOT OPTIONAL)
**Tests first (strong default):** For business logic, API routes, services, utilities — write failing tests FIRST from the acceptance criteria, then implement until green. Tests define "done."
**Tests after (escape hatch):** UI components and exploratory work only — implement first but tests MUST exist before the request is marked complete. State why you're using this escape.
**Never optional:** No request is complete without tests. The Execute step is: (1) write failing tests from acceptance criteria, (2) implement until tests pass, (3) verify with validate.sh.
**Test-driven requests:** Each request file lists "Tests to Write" — these are written FIRST as failing tests. Failing tests guide the implementation. When all tests pass, the request is done.

## Git Workflow
Branch per phase: `phase-N-description`. Commit after each logical unit of work. Commit message format: `type(scope): description` (feat, fix, refactor, test, docs, chore). PR per request when prWorkflowEnabled.

## Compaction
On context recovery, read: CLAUDE.md, .claude/handoff.md, the current request file from requests/, and audits/debt.md. This restores full working context.

## Definition of Done
A request is done when: all acceptance criteria met, all tests pass, `scripts/validate.sh` passes, references/ updated if needed, handoff.md updated, no new untracked debt introduced without logging it.

## Knowledge Base
Before solving novel problems, check knowledge/ for existing solutions from other projects. If you discover a reusable lesson, tag it with [LESSON] in your handoff notes for the harvester to pick up.
