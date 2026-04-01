# Bug Hunt

## When to Use
Run systematically after completing a set of features, before phase completion, or when unexpected behavior is reported. Catches bugs that tests alone miss.

## Procedure

### 1. Run Full Test Suite
```
pnpm test
```
Document any failures — these are confirmed bugs.

### 2. TypeScript Strict Check
```
pnpm exec tsc --noEmit
```
Every error is a potential bug. Pay attention to:
- Implicit `any` types
- Null/undefined access without checks
- Type mismatches between function signatures and call sites

### 3. ESLint Check
```
pnpm lint
```
Focus on errors (not warnings). React hooks dependency issues are particularly bug-prone.

### 4. Next.js Pitfalls
- **Client/server boundary**: Search for `fs`, `child_process`, `prisma` imports in files with `"use client"` — these will crash at runtime
- **Missing "use client"**: Components using useState/useEffect without the directive
- **Dynamic route params**: In Next.js 15+, params is a Promise — check all `[slug]` pages
- **Server-only imports**: Ensure server-only code isn't accidentally bundled for client

### 5. Prisma Patterns
- Uncaught Prisma errors (findUniqueOrThrow without try/catch)
- Missing `await` on Prisma queries (floating promises)
- Incorrect relation queries (wrong field names in `include`)
- SQLite-specific: JSON fields stored as String must be parsed before use

### 6. Error Handling
- API routes without try/catch returning 500 with stack traces
- Missing error.tsx boundary files for route segments
- Unhandled promise rejections in async operations
- Missing validation on user inputs in API routes

### 7. Race Conditions
- Concurrent file system reads during scanning
- Multiple simultaneous API requests modifying the same DB record
- Stale closures in useEffect callbacks

## Output Format
```
## Bug Hunt Report

### Confirmed Bugs (test failures)
- [BUG-001] path/to/file:line — Description

### TypeScript Issues
- [TS-001] path/to/file:line — Description

### Runtime Risk (will crash in browser/server)
- [RUNTIME-001] path/to/file:line — Server import in client component

### Logic Issues
- [LOGIC-001] path/to/file:line — Description

### Injection Risks
- [INJ-001] path/to/file:line — Unvalidated input in shell command
- Grep for: execSync, execFileSync, spawn — verify all interpolated values validated

### JSON Safety
- [JSON-001] path/to/file:line — JSON.parse without try-catch
- Every JSON.parse on external/DB data must be in try-catch

### Non-null Assertions
- [NULL-001] path/to/file:line — Unsafe ! assertion
- Grep for `!` post-fix — verify the value cannot be null

### Timeout Audit
- [TIMEOUT-001] path/to/file:line — External fetch without AbortController
- Every fetch to external APIs must have a timeout

### Summary
- Confirmed bugs: N
- High-risk issues: N
- Medium-risk issues: N
```
