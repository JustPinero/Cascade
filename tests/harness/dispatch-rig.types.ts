/**
 * Phase 23.1 — Dispatch Rig types.
 *
 * Pure types, no runtime. The implementation lives in dispatch-rig.ts.
 * Reference: references/dispatch-rig.md.
 */

import type { PrismaClient } from "@/app/generated/prisma/client";
import type { DispatchQueue } from "@/lib/dispatch-queue";

export interface DispatchRigOptions {
  /** Queue concurrency cap. Default 1 — keeps scenarios deterministic. */
  concurrency?: number;
  /** Install vi.useFakeTimers() at construction. Default true. */
  fakeTimers?: boolean;
}

/**
 * One captured call to the mocked child_process.spawn.
 * Read-only snapshot of args; the rig adds entries via runtime
 * introspection of the test file's vi.mock'd spawn.
 */
export interface SpawnRecord {
  command: string;
  args: string[];
  opts: Record<string, unknown>;
}

/**
 * Mock controller for the Anthropic Messages API.
 * Pass a handler that maps a request body to a response shape; the
 * rig installs a fetch interceptor that fires the handler whenever
 * the test code POSTs to api.anthropic.com.
 */
export type AnthropicMockHandler = (params: unknown) => unknown;

export interface FireWebhookOptions {
  projectPath: string;
  idempotencyKey?: string;
  /**
   * Optional log content the webhook handler will see when it reads
   * the project's session log. Pass when testing escalation detection.
   */
  logContent?: string;
}

export interface FireWebhookResult {
  status: number;
  body: unknown;
}

export interface DispatchRig {
  /** Real Prisma client backed by an isolated scratch SQLite db. */
  prisma: PrismaClient;
  /** Fresh DispatchQueue singleton scoped to this rig instance. */
  queue: DispatchQueue;

  /**
   * Snapshot of every call captured from the test file's vi.mock'd
   * spawn. Empty if the test file did not mock child_process.
   */
  readonly spawnRecords: SpawnRecord[];

  /**
   * Seed a project row in the rig's prisma. Path defaults to the
   * shared cascade-test-project fixture; pass a real path on disk if
   * the test needs filesystem-backed behavior.
   */
  createProject(opts: {
    slug: string;
    name?: string;
    path?: string;
    status?: string;
    health?: string;
  }): Promise<{
    id: number;
    slug: string;
    name: string;
    path: string;
  }>;

  /** Advance vi fake timers, awaiting microtasks between ticks. */
  advanceTime(ms: number): Promise<void>;

  /**
   * Fetch all DispatchOutcome rows in the rig's DB. If `slug` is
   * provided, scope to that project.
   */
  getDispatchOutcomes(slug?: string): Promise<
    Array<{
      id: number;
      projectSlug: string;
      mode: string;
      outcome: string;
      dispatchId: string | null;
    }>
  >;

  /**
   * Fetch all Dispatch rows in the rig's DB, optionally scoped to a
   * project slug. Phase 23.2+ — exposes the Dispatch table for
   * scenario assertions.
   */
  getDispatches(slug?: string): Promise<
    Array<{
      id: string;
      idempotencyKey: string;
      projectSlug: string;
      mode: string;
      status: string;
      errorMessage: string | null;
    }>
  >;

  /**
   * Invoke the real /api/webhook/session-complete route handler against
   * the rig's prisma. Test files using this method MUST install the
   * boilerplate `vi.mock("@/lib/db", ...)` proxy at the file top — see
   * fireWebhook's JSDoc in dispatch-rig.ts for the exact mock factory.
   */
  fireWebhook(opts: FireWebhookOptions): Promise<FireWebhookResult>;

  /**
   * Fetch ActivityEvent rows. Filter by project slug and/or event type.
   */
  getActivityEvents(opts?: {
    slug?: string;
    type?: string;
  }): Promise<
    Array<{
      id: number;
      projectId: number | null;
      eventType: string;
      summary: string;
    }>
  >;

  /**
   * Register a handler for outgoing fetches to api.anthropic.com.
   * Once registered, the handler is invoked for every Anthropic
   * request the test code makes (directly or via overseer-tools).
   * Without registering, an Anthropic call throws a clear error so
   * silent network calls are caught.
   */
  mockAnthropicResponse(handler: AnthropicMockHandler): void;

  /**
   * Restore real timers, drop the scratch SQLite, reset the dispatch
   * queue singleton, uninstall the fetch interceptor. Idempotent.
   */
  dispose(): Promise<void>;
}
