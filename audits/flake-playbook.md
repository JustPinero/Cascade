# Flake Playbook

Captured patterns from Phase 23 flake hunts. When a test fails on retry only, work through these in order.

## Pattern A — parallel `prisma db push` race

### Fingerprint
- Multiple test files fail intermittently, often on first-run-of-a-fresh-checkout, green on retry.
- Failures cluster on rig-using tests (any file that constructs a scratch SQLite via `pushTestSchema` or the dispatch rig).
- Errors look like `Cannot find module '@/app/generated/prisma/client'` or `default.create is not a function` or `The table main.<Model> does not exist`.

### Why
Vitest workers run test files in parallel processes. Each process that calls `prisma db push` triggers `prisma generate` which writes to the shared `app/generated/prisma/` output. Concurrent generates corrupt each other; corrupt clients then fail at runtime.

### Fix (already in place since Phase 23.7)
- `tests/harness/global-setup.ts` is registered in `vitest.config.ts` as `globalSetup`.
- It pushes the schema **once per test run** to `prisma/test-rig-template.db`.
- The rig copies the template per-rig instead of pushing — `tests/harness/dispatch-rig.ts:preparePerRigDb`.

### When to investigate further
Only if NEW test files start showing this fingerprint. Likely causes:
- A new test file pushes schema directly without going through the rig — port it onto the rig.
- The globalSetup itself is racing with something — verify it ran first by checking template file existence in the failing test.

## Pattern B — microtask-timing race on fire-and-forget writes

### Fingerprint
- A specific test fails ~1 in 5 runs.
- The test calls a fire-and-forget function (e.g. `logUsage`) and then asserts a row exists.
- Failures show "expected 1 row, got 0" or similar.

### Why
`logUsage` and similar use `queueMicrotask` to schedule the Prisma insert. The test's `flushMicrotasks` helper waited a fixed 50ms — under parallel-worker SQLite contention that wasn't always enough.

### Fix (already in place)
`flushMicrotasks` waits 500ms in `lib/anthropic-usage-log.test.ts`. The 50ms was racy under load; 500ms is overkill for healthy workers but stable.

### Better long-term shape
If new fire-and-forget tests appear, polling for the condition is more honest than a fixed wait:

```ts
async function pollForRow<T>(query: () => Promise<T | null>, budgetMs = 1000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < budgetMs) {
    const row = await query();
    if (row !== null) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("row never appeared within budget");
}
```

## Diagnostic commands

### Reproduce a flake
```bash
for i in 1 2 3 4 5 6 7 8; do
  echo "=== run $i ==="
  pnpm test 2>&1 | grep -E "Tests  " | tail -1
done
```

If the flake doesn't reproduce in 8 runs, it's either: (a) genuinely fixed, (b) only happens on cold caches / fresh checkouts, or (c) race-window is wider than the local machine's load lets you see (check CI behavior).

### Pinpoint the failing test
```bash
pnpm test 2>&1 | grep -E "FAIL\b|✗|×" | head -10
```

If the same test fails consistently across 5+ retries, it's NOT a flake — it's a real failure. Stop using this playbook and treat as a normal regression.

### Bypass test-file mocks for harness internals
When a test file does `vi.mock("fs", ...)` or `vi.mock("child_process", ...)` and the rig needs the real binding for setup work (schema push, fixture copy), use `vi.importActual`:

```ts
const realFs = await vi.importActual<typeof import("fs")>("fs");
realFs.copyFileSync(src, dst);
```

This was the fix for the test-rig template-copy issue in Phase 23.7.

## When NONE of these apply

The flake might be in production code, not test setup. Look for:
- Singletons being cross-contaminated between test files (queue, prisma client, vi.mock leftovers)
- File-system races (multiple tests writing to the same path)
- Process-level state leaks (env vars, globalThis, timers)

In those cases, the fix is usually: (1) make the code accept dependency injection, (2) reset module state explicitly in `afterEach`, or (3) move the test to use the rig which already handles these concerns.
