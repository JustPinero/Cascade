# Test Audit

## When to Use
Run after completing a feature or request to verify test coverage quality. Use before phase completion or when test confidence is low.

## Procedure

### 1. Run Full Test Suite
```
pnpm test -- --reporter=verbose
```
Capture pass/fail counts and any failures.

### 2. Analyze Coverage Gaps
- Check that all API routes in `app/api/` have corresponding test files
- Check that all components in `app/components/` have tests for key behaviors
- Check that all service files in `lib/` have unit tests
- Look for files with zero test coverage

### 3. Check Edge Cases
- Error paths: are error responses tested?
- Empty states: are empty arrays/null values tested?
- Boundary values: pagination limits, max string lengths
- Auth/permission scenarios (future phases)

### 4. Verify Test Quality
- No snapshot tests used as a crutch (test behavior, not markup)
- Mocks are minimal — prefer integration tests for API routes
- Assertions are specific (not just "doesn't throw")
- Test descriptions clearly state expected behavior

### 5. Prisma-Specific Checks
- Database tests use a test database, not dev
- Tests clean up after themselves (no leaked state between tests)
- Migration/schema changes have corresponding test updates

## Output Format
```
## Test Audit Report

### Summary
- Total tests: N | Pass: N | Fail: N | Skipped: N
- Files with tests: N / N total (X%)

### Coverage Gaps
- [CRITICAL] path/to/file — No tests at all
- [HIGH] path/to/file — Missing error path tests
- [MEDIUM] path/to/file — Missing edge case tests

### Test Quality Issues
- [QUALITY] path/to/test — Weak assertions
- [QUALITY] path/to/test — Excessive mocking

### Recommendations
1. Priority action items
```
