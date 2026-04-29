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

describe("DEFAULT_REGISTRY module-level cache (Phase 13.3 / 17)", () => {
  it("buildDefaultRegistry runs EXACTLY ONCE per route module load", async () => {
    // Reset module cache first so we know the import is fresh.
    vi.resetModules();

    // Re-import the factory so the spy targets the same instance the
    // route will see post-reset.
    const factoryModule = await vi.importActual<
      typeof import("@/lib/overseer-tools-registry-default")
    >("@/lib/overseer-tools-registry-default");

    const spy = vi.spyOn(factoryModule, "buildDefaultRegistry");

    // Stub the route's own dependency on the factory so it sees our
    // spied version, not the cached pre-reset one.
    vi.doMock("@/lib/overseer-tools-registry-default", () => factoryModule);

    // First import: the route's top-level statement should run once.
    await import("@/app/api/overseer/chat/route");
    expect(spy).toHaveBeenCalledTimes(1);

    // Subsequent imports hit Node's module cache — no additional call.
    await import("@/app/api/overseer/chat/route");
    await import("@/app/api/overseer/chat/route");
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    vi.doUnmock("@/lib/overseer-tools-registry-default");
  });
});
