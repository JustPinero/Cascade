import { describe, it, expect } from "vitest";
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
