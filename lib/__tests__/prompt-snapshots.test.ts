/**
 * Phase 23.4 — prompt + tool snapshot tests.
 *
 * Snapshots freeze every cached prefix in the codebase so a future PR
 * that mutates a system prompt or tool description fails loudly. The
 * snapshot diff is the review surface — it should never land green
 * without intentional review.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";
import { TOOL_PATH_SYSTEM_PROMPT } from "@/app/api/overseer/chat/route";

describe("Overseer system + tools snapshot", () => {
  it("Overseer system prompt is stable", () => {
    expect(TOOL_PATH_SYSTEM_PROMPT).toMatchSnapshot();
  });

  it("Overseer tool definitions are stable (and last tool carries cache_control)", () => {
    const tools = buildDefaultRegistry().toAnthropicTools();
    expect(tools).toMatchSnapshot();
    // Smoke: prefix-marker invariant. If this fires, the cache prefix
    // hash has changed and every existing cache entry will miss until
    // a fresh write lands. Intentional only.
    expect(tools[tools.length - 1].cache_control).toEqual({ type: "ephemeral" });
    for (let i = 0; i < tools.length - 1; i++) {
      expect(tools[i].cache_control).toBeUndefined();
    }
  });

  it("Overseer combined prefix exceeds Sonnet 4.6's 2,048-token cache minimum", () => {
    // Char-to-token approximation: ~3.5 chars/token is conservative
    // for English text. Sonnet 4.6 minimum is 2,048; require room.
    const tools = buildDefaultRegistry().toAnthropicTools();
    const combined =
      TOOL_PATH_SYSTEM_PROMPT +
      tools
        .map(
          (t) =>
            `${t.name}\n${t.description}\n${JSON.stringify(t.input_schema)}`
        )
        .join("\n");
    const approxTokens = combined.length / 3.5;
    expect(approxTokens).toBeGreaterThan(2048);
  });
});
