---
paths:
  - "**/*.test.*"
---
# Test Rules (Vitest + Playwright)

- TDD is not optional: business logic, API routes, services, and utilities get failing tests FIRST from acceptance criteria, then implementation until green. UI components may test-after, but tests must exist before the request is complete.
- Every acceptance criterion in a request maps to a specific test. When all pass, the request is done.
- Run with `pnpm test` (Vitest). Full gate is `scripts/validate.sh` — the same script CI runs.
- Tests that need a database must use an isolated throwaway SQLite file (see the `test-rig-*` pattern in `prisma/`), never the live `./dev.db`.
- No `any`, no `@ts-ignore`, no `as unknown as` — strict mode applies to test files too.
- Mock external boundaries (Anthropic API, `gh`/`op` shell-outs, filesystem scans of other projects); don't hit real services in unit tests.
