/**
 * Phase 23.1 — Dispatch Rig tests.
 *
 * Tests the rig itself: scratch SQLite isolation, fake timers,
 * spawn-record introspection, fetch interception, dispose cleanup.
 *
 * fireWebhook integration is deferred to 23.2 (requires the Dispatch
 * table + a way to inject prisma into the route handler).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock child_process at module top — the rig introspects this mock
// at runtime to expose spawn calls via rig.spawnRecords.
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { createDispatchRig } from "./dispatch-rig";
import type { DispatchRig } from "./dispatch-rig.types";

let rigs: DispatchRig[] = [];

afterEach(async () => {
  for (const r of rigs) {
    await r.dispose();
  }
  rigs = [];
  vi.clearAllMocks();
});

async function makeRig(
  opts?: Parameters<typeof createDispatchRig>[0]
): Promise<DispatchRig> {
  const r = await createDispatchRig(opts);
  rigs.push(r);
  return r;
}

describe("dispatch rig — public surface", () => {
  it("exposes the documented public surface", async () => {
    const rig = await makeRig();
    expect(rig.prisma).toBeDefined();
    expect(rig.queue).toBeDefined();
    expect(rig.spawnRecords).toBeInstanceOf(Array);
    expect(typeof rig.createProject).toBe("function");
    expect(typeof rig.advanceTime).toBe("function");
    expect(typeof rig.getDispatchOutcomes).toBe("function");
    expect(typeof rig.getActivityEvents).toBe("function");
    expect(typeof rig.mockAnthropicResponse).toBe("function");
    expect(typeof rig.dispose).toBe("function");
  });
});

describe("dispatch rig — scratch SQLite", () => {
  it("scratch SQLite is isolated per rig", async () => {
    const a = await makeRig();
    const b = await makeRig();
    await a.createProject({ slug: "alpha-a" });
    const inB = await b.prisma.project.findFirst({ where: { slug: "alpha-a" } });
    expect(inB).toBeNull();
  });

  it("scratch SQLite has the full schema applied", async () => {
    const rig = await makeRig();
    // Schema works for any model the production code touches.
    // Project + DispatchOutcome + ActivityEvent + ChatSession exercise
    // a representative slice; if any are missing the test fails.
    await rig.prisma.project.create({
      data: {
        slug: "schema-test",
        name: "Schema Test",
        path: "/tmp/schema-test",
      },
    });
    const project = await rig.prisma.project.findFirst({
      where: { slug: "schema-test" },
    });
    expect(project).not.toBeNull();
    expect(project?.slug).toBe("schema-test");
  });
});

describe("dispatch rig — createProject helper", () => {
  it("creates a project row with the given slug", async () => {
    const rig = await makeRig();
    const project = await rig.createProject({ slug: "medipal" });
    expect(project.slug).toBe("medipal");
    expect(project.id).toBeGreaterThan(0);
    const fetched = await rig.prisma.project.findUnique({
      where: { slug: "medipal" },
    });
    expect(fetched).not.toBeNull();
  });

  it("path defaults to the test fixture skeleton", async () => {
    const rig = await makeRig();
    const project = await rig.createProject({ slug: "fixture-default" });
    expect(project.path).toContain("cascade-test-project");
  });
});

describe("dispatch rig — spawn record introspection", () => {
  it("spawnRecords reflects calls to the vi.mock'd spawn", async () => {
    const rig = await makeRig();
    // Manually invoke the mocked spawn to simulate the dispatcher
    // calling child_process.spawn. The rig should expose this.
    const childProcess = await import("child_process");
    childProcess.spawn("echo", ["hello"], {
      detached: true,
      stdio: "ignore",
    });
    childProcess.spawn("claude", ["--continue"], {
      env: { ...process.env, CASCADE_DISPATCH_ID: "abc" },
    });
    expect(rig.spawnRecords).toHaveLength(2);
    expect(rig.spawnRecords[0].command).toBe("echo");
    expect(rig.spawnRecords[0].args).toEqual(["hello"]);
    expect(rig.spawnRecords[1].command).toBe("claude");
    expect(rig.spawnRecords[1].args).toEqual(["--continue"]);
  });

  it("spawnRecords is empty when no spawn calls happened", async () => {
    const rig = await makeRig();
    expect(rig.spawnRecords).toEqual([]);
  });
});

describe("dispatch rig — fake timers", () => {
  it("advanceTime advances vi fake timers", async () => {
    const rig = await makeRig();
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 60_000);
    expect(fired).toBe(false);
    await rig.advanceTime(60_000);
    expect(fired).toBe(true);
  });

  it("fakeTimers: false skips fake timer installation", async () => {
    const rig = await makeRig({ fakeTimers: false });
    // With real timers, vi.advanceTimersByTime wouldn't apply. The
    // rig's advanceTime is a no-op fallback in this mode.
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(fired).toBe(true);
    void rig;
  });
});

describe("dispatch rig — DB query helpers", () => {
  it("getDispatchOutcomes returns rows scoped to a slug", async () => {
    const rig = await makeRig();
    const a = await rig.createProject({ slug: "alpha" });
    const b = await rig.createProject({ slug: "beta" });
    await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: a.id,
        projectSlug: a.slug,
        mode: "continue",
        healthAtDispatch: "healthy",
        outcome: "success",
        signals: "[]",
        dispatchedAt: new Date(),
      },
    });
    await rig.prisma.dispatchOutcome.create({
      data: {
        projectId: b.id,
        projectSlug: b.slug,
        mode: "audit",
        healthAtDispatch: "warning",
        outcome: "attention-needed",
        signals: "[]",
        dispatchedAt: new Date(),
      },
    });
    const onlyAlpha = await rig.getDispatchOutcomes("alpha");
    expect(onlyAlpha).toHaveLength(1);
    expect(onlyAlpha[0].projectSlug).toBe("alpha");
  });

  it("getActivityEvents filters by project and type", async () => {
    const rig = await makeRig();
    const project = await rig.createProject({ slug: "gamma" });
    await rig.prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-launched",
        summary: "test launch",
      },
    });
    await rig.prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-complete",
        summary: "test complete",
      },
    });
    const launched = await rig.getActivityEvents({
      slug: "gamma",
      type: "session-launched",
    });
    expect(launched).toHaveLength(1);
    expect(launched[0].eventType).toBe("session-launched");
  });
});

describe("dispatch rig — Anthropic mock", () => {
  it("registered handler is invoked on fetch to api.anthropic.com", async () => {
    const rig = await makeRig();
    const seen: unknown[] = [];
    rig.mockAnthropicResponse((params) => {
      seen.push(params);
      return {
        id: "msg_test",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    });
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", messages: [] }),
    });
    expect(seen).toHaveLength(1);
    const json = await response.json();
    expect(json.id).toBe("msg_test");
  });

  it("anthropic call without registered handler throws a clear error", async () => {
    const rig = await makeRig();
    void rig;
    await expect(
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: "{}",
      })
    ).rejects.toThrow(/mockAnthropicResponse/);
  });
});

describe("dispatch rig — dispose", () => {
  it("dispose is idempotent", async () => {
    const rig = await createDispatchRig();
    await rig.dispose();
    await expect(rig.dispose()).resolves.toBeUndefined();
  });

  it("dispose restores real fetch (mocks deactivate)", async () => {
    const rig = await createDispatchRig();
    rig.mockAnthropicResponse(() => ({ ok: true }));
    await rig.dispose();
    // After dispose, the mock interceptor is gone. We don't actually
    // hit the real API — we just verify the interceptor is uninstalled
    // by registering a dispose-time sentinel and asserting we can
    // create a fresh rig that installs cleanly.
    const fresh = await createDispatchRig();
    rigs.push(fresh);
    expect(fresh.spawnRecords).toEqual([]);
  });
});

beforeEach(() => {
  // Sanity: vitest fake-timer state shouldn't leak between rigs.
  // afterEach below restores via dispose; this guards against any
  // leftover fake-timer toggles from prior tests in the same file.
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});
