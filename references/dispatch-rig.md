# Dispatch Rig — shared test harness for the dispatch service

The dispatch service spans `lib/claude-dispatcher.ts`, `lib/dispatch-queue.ts`, `app/api/dispatch/**`, and `app/api/webhook/session-complete/route.ts`. Each piece has unit tests; what fails today is **system-level coverage** — the path from enqueue → spawn → Stop hook → DispatchOutcome write. Almost every dispatch bug we feel in production lives in that span.

The rig is one shared test harness so scenario tests read like 10-line stories instead of re-mocking `child_process`, `execSync`, fs, fetch, and Prisma in every file.

## Location

```
tests/harness/
  dispatch-rig.ts            # entry point
  dispatch-rig.types.ts      # public types
  fixtures/
    project-skeletons/       # tiny on-disk project trees that pass importSingleProject
    session-logs/            # real recorded session.log files for escalation tests
```

Pure helpers — no Vitest globals, no test framework lock-in.

## Public surface

```ts
export interface DispatchRig {
  prisma: PrismaClient;                  // bound to a scratch SQLite db
  queue: DispatchQueue;                  // fresh per rig
  // builders
  createProject(opts: { slug: string; path?: string }): Promise<Project>;
  // queue + dispatch lifecycle
  beginDispatch(opts: BeginDispatchOpts): Promise<PendingDispatch>;
  // webhook simulation
  fireWebhook(opts: { projectPath: string; sessionId?: string; logContent?: string }): Promise<Response>;
  // time control
  advanceTime(ms: number): Promise<void>;
  // assertions
  getDispatchOutcomes(slug: string): Promise<DispatchOutcome[]>;
  getActivityEvents(slug: string, type?: string): Promise<ActivityEvent[]>;
  // teardown
  dispose(): Promise<void>;
}

export interface BeginDispatchOpts {
  slug: string;
  mode: "continue" | "audit" | "investigate" | "custom";
  customPrompt?: string;
  // If set, the mocked spawn throws synchronously. Useful for command-not-found
  // simulations. Default: spawn returns a stub child without error, matching
  // production fire-and-forget behavior. There is deliberately no "hang" state
  // — at runtime the dispatcher cannot distinguish "hung" from "running" since
  // it never observes process exit, so a hang scenario is simply: enqueue,
  // do not call fireWebhook(), advance time past the watchdog deadline.
  spawnThrows?: Error;
}

export interface PendingDispatch {
  dispatchId: string;     // the new Dispatch row id (post-Phase-23.2)
  projectPath: string;
  // resolves when the dispatcher's enqueue returns. Does NOT wait for webhook.
  enqueued: Promise<void>;
  // resolves when fireWebhook for this dispatch lands.
  complete: Promise<void>;
}
```

## Construction

```ts
export async function createDispatchRig(opts?: {
  concurrency?: number;     // default 1 — keeps scenarios deterministic
  fakeTimers?: boolean;     // default true
}): Promise<DispatchRig>
```

Steps `createDispatchRig` performs:

1. Scratch SQLite at `file:./test-dispatch-${randomId}.db?mode=memory&cache=shared`. Run `pushTestSchema(prisma)` so it matches `prisma/schema.prisma`.
2. Reset `getDispatchQueue()` singleton via `__resetDispatchQueueForTests()` and construct a queue at the requested concurrency.
3. Install vi.useFakeTimers() if `fakeTimers !== false`.
4. Install spawn/execSync mocks (see below).
5. Install fetch mock for the webhook (see below).

`dispose()` reverses each step, deletes the SQLite file, restores real timers and modules.

## Mocks the rig owns

### `child_process.spawn` and `execSync`

The dispatcher is fire-and-forget — it spawns a process and never observes exit. The mock therefore returns a no-op `ChildProcess` shape and records calls so tests can assert "spawn was called with args X."

```ts
type SpawnRecord = { command: string; args: string[]; opts: SpawnOptions };
rig.spawnRecords: SpawnRecord[];

// Default: spawn returns a stub child without error.
// Override per dispatch via BeginDispatchOpts.spawnThrows = new Error("...")
// to simulate command-not-found or other synchronous spawn failures.
```

`execSync` is mocked the same way for `tmux` calls. Default behavior: succeed silently. Per-call override via `rig.setExecSyncBehavior(/respawn-pane/, () => { throw new Error("pane gone"); })`.

### Webhook simulation

`fireWebhook` constructs a NextRequest body matching the real Stop-hook ping shape and invokes the route handler **directly** (importing `POST` from `app/api/webhook/session-complete/route.ts`). It does not start an HTTP server. The handler runs against `rig.prisma`.

```ts
await rig.fireWebhook({
  projectPath: "/tmp/medipal",
  sessionId: "abc123",          // post-Phase-23.2: matches Dispatch.idempotencyKey
  logContent: "...",            // optional — written to a fixture session.log so escalation detection has something to read
});
```

### Anthropic API mock

Some tests touch the dispatcher AND the Overseer (e.g. an end-to-end "user requested a dispatch from chat → it completed → Overseer queries the outcome"). The rig provides:

```ts
rig.mockAnthropicResponse(handler: (params: AnthropicMessageParams) => AnthropicMessageResponse): void;
```

By default the rig fails the test if Anthropic is called without a mock — caught usage you didn't expect.

## Scenario test shape

```ts
// tests/scenarios/webhook-before-dispatch-event.test.ts
import { test, expect } from "vitest";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";

test("webhook arriving before activity event commits still creates outcome", async () => {
  const rig = await createDispatchRig();
  await rig.createProject({ slug: "medipal" });

  const dispatch = await rig.beginDispatch({ slug: "medipal", mode: "continue" });
  // simulate the race: webhook resolves before the dispatcher's
  // post-spawn activity event commits
  await rig.fireWebhook({
    projectPath: dispatch.projectPath,
    sessionId: dispatch.dispatchId,
  });
  await dispatch.complete;

  expect(await rig.getDispatchOutcomes("medipal")).toHaveLength(1);
  await rig.dispose();
});
```

Ten lines, plus the rig.

## Migration path for existing tests

`lib/claude-dispatcher.multi.test.ts` and `lib/dispatch-queue.test.ts` already test their layers in isolation — leave them. The rig is **additive**: new `tests/scenarios/*.test.ts` files that exercise interactions, plus port one or two of the existing tests onto the rig as a sanity check (proves the rig is real, not theater).

## Why fake timers

Several scenarios (hung session, queue starvation under throws, time-based webhook idempotency) are time-dependent. Real timers make these tests slow or flaky. `vi.useFakeTimers()` + `rig.advanceTime(30 * 60 * 1000)` lets a hung-session test prove the watchdog fires at 30 minutes without waiting 30 minutes.

## What the rig does NOT mock

- Prisma. Tests run against real SQLite. Catches schema drift, race conditions in DB writes, and idempotency-key collisions for real.
- `path`, `fs`. Tests use real files in fixture directories; the project-skeleton fixtures are tiny but real.

The rule: mock the things that are slow/external/non-deterministic (process spawn, network, time). Don't mock the things you're testing the integration of (the DB, the file system).
