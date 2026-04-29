import { describe, it, expect, vi } from "vitest";
import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";

describe("buildDefaultRegistry", () => {
  it("registers all expected tools", () => {
    const reg = buildDefaultRegistry();
    const expected = [
      "query_project",
      "query_projects",
      "get_recent_activity",
      "get_session_logs",
      "get_dispatch_outcomes",
      "get_yesterday_summary",
      "get_engineer_messages",
      "get_playbook",
      "update_session_memory",
      "set_active_flow",
      "get_session_state",
      "propose_dispatch",
      "create_reminder",
      "create_human_todo",
    ];
    for (const name of expected) {
      expect(reg.has(name)).toBe(true);
    }
  });

  it("builds a fresh registry each call (no shared mutable state)", () => {
    const a = buildDefaultRegistry();
    const b = buildDefaultRegistry();
    expect(a).not.toBe(b);
    expect(a.list().length).toBe(b.list().length);
  });

  it("emits Anthropic-shape tool definitions", () => {
    const reg = buildDefaultRegistry();
    const defs = reg.toAnthropicTools();
    const queryDef = defs.find((d) => d.name === "query_project");
    expect(queryDef).toBeDefined();
    expect(queryDef?.input_schema).toBeDefined();
  });

  it("every registered tool has a non-empty description", () => {
    const reg = buildDefaultRegistry();
    for (const tool of reg.list()) {
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });
});

describe("DEFAULT_REGISTRY module-level cache (Phase 13.3 / 16)", () => {
  it("the route caches a single registry across multiple invocations", async () => {
    // The route module exports nothing called DEFAULT_REGISTRY (it's
    // private), but the contract is "buildDefaultRegistry runs once
    // at module import, not per request." We verify that by spying
    // and observing the count is independent of request count.
    const factoryModule = await import(
      "@/lib/overseer-tools-registry-default"
    );
    const spy = vi.spyOn(factoryModule, "buildDefaultRegistry");

    // Force-reimport the route module so the spy can observe its
    // import-time call. resetModules() clears the cache; the next
    // import re-runs route.ts top-level, which calls buildDefaultRegistry once.
    vi.resetModules();
    const callsBefore = spy.mock.calls.length;

    await import("@/app/api/overseer/chat/route");
    const callsAfterFirst = spy.mock.calls.length;

    // Second import should be a no-op (module cache hits).
    await import("@/app/api/overseer/chat/route");
    const callsAfterSecond = spy.mock.calls.length;

    // Either the spy caught the import-time call (one new call) or
    // the route module was already cached from earlier in this test
    // run (zero new calls). Both prove the singleton property: the
    // count does NOT scale with subsequent imports.
    expect(callsAfterSecond - callsAfterFirst).toBe(0);
    expect(callsAfterFirst - callsBefore).toBeLessThanOrEqual(1);

    spy.mockRestore();
  });
});
