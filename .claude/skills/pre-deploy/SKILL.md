# Pre-Deploy Checklist

## When to Use
Run before any deployment — local preview, staging, or production. All checks must pass.

## Stack-Specific Checklist

### Build & Tests
- [ ] `pnpm build` succeeds with no errors
- [ ] `pnpm test` passes all tests
- [ ] `pnpm lint` clean (no errors)
- [ ] `pnpm exec tsc --noEmit` — TypeScript strict check passes

### Next.js
- [ ] No hardcoded `localhost` URLs in production code
- [ ] Server/client component boundaries correct (no fs/prisma in client)
- [ ] All dynamic routes handle params correctly
- [ ] error.tsx and loading.tsx files in place for key routes
- [ ] No console.log in production code (except intentional logging)

### Prisma + SQLite
- [ ] `pnpm exec prisma db push --dry-run` — schema is clean
- [ ] Database file in .gitignore
- [ ] Prisma queries use proper error handling
- [ ] WAL mode enabled
- [ ] No raw SQL queries with unsanitized input

### Security
- [ ] ANTHROPIC_API_KEY only used server-side (not in client bundles)
- [ ] No exposed API keys or secrets in client-side code
- [ ] Environment variables documented in references/env-vars.md
- [ ] .env.local in .gitignore
- [ ] Shell command inputs sanitized (gh, op CLI calls)

### Documentation
- [ ] references/schema.md matches prisma/schema.prisma
- [ ] references/api-contracts.md matches actual API routes
- [ ] CLAUDE.md is up to date
- [ ] .claude/handoff.md is current

## Procedure
1. Run each check above
2. For any failure, document the issue and remediation
3. All checks must pass before proceeding with deployment
4. Generate report with pass/fail status for each item

## Output
```
## Pre-Deploy Report

### Results
- [PASS] Build succeeds
- [FAIL] Found console.log in app/api/projects/route.ts:42
  Fix: Remove or replace with proper logger

### Summary
- Passed: N/N
- Status: READY / NOT READY
```
