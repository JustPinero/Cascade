/**
 * Phase 23.6 — asserter tests.
 */
import { describe, it, expect } from "vitest";
import {
  assertToolSequence,
  assertKnowledgeMatchTopN,
  assertEscalationSignals,
  extractToolCalls,
} from "./asserters";

describe("extractToolCalls", () => {
  it("pulls every tool_use block from assistant turns in order", () => {
    const calls = extractToolCalls([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "ok" },
          { type: "tool_use", id: "1", name: "alpha", input: { x: 1 } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "result" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "2", name: "beta", input: { y: 2 } },
        ],
      },
    ]);
    expect(calls.map((c) => c.name)).toEqual(["alpha", "beta"]);
    expect(calls[0].input).toEqual({ x: 1 });
  });
});

describe("assertToolSequence", () => {
  it("passes when expected sequence appears in observed", () => {
    const result = assertToolSequence(
      {
        toolCalls: [
          { name: "alpha", input: {} },
          { name: "beta", input: {} },
        ],
        finalText: "done",
      },
      { toolSequence: [{ name: "alpha" }, { name: "beta" }] }
    );
    expect(result.pass).toBe(true);
  });

  it("fails with a structured diff when sequence mismatches", () => {
    const result = assertToolSequence(
      {
        toolCalls: [
          { name: "alpha", input: {} },
          { name: "gamma", input: {} },
        ],
        finalText: "done",
      },
      { toolSequence: [{ name: "alpha" }, { name: "beta" }] }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toContain("expected: beta");
    expect(result.diff).toContain("alpha");
  });

  it("supports inputContains partial matching", () => {
    const result = assertToolSequence(
      {
        toolCalls: [
          {
            name: "query_project",
            input: { slug: "medipal", verbose: true },
          },
        ],
        finalText: "ok",
      },
      {
        toolSequence: [
          { name: "query_project", inputContains: { slug: "medipal" } },
        ],
      }
    );
    expect(result.pass).toBe(true);
  });

  it("respects minToolCalls", () => {
    const result = assertToolSequence(
      { toolCalls: [{ name: "a", input: {} }], finalText: "" },
      { minToolCalls: 2 }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toMatch(/at least 2/);
  });

  it("respects maxToolCalls", () => {
    const result = assertToolSequence(
      {
        toolCalls: [
          { name: "a", input: {} },
          { name: "b", input: {} },
          { name: "c", input: {} },
        ],
        finalText: "",
      },
      { maxToolCalls: 2 }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toMatch(/at most 2/);
  });

  it("matches finalText against a regex string", () => {
    const result = assertToolSequence(
      { toolCalls: [], finalText: "the medipal project is healthy" },
      { finalTextMatches: "/medipal/i" }
    );
    expect(result.pass).toBe(true);

    const failed = assertToolSequence(
      { toolCalls: [], finalText: "no match here" },
      { finalTextMatches: "/medipal/i" }
    );
    expect(failed.pass).toBe(false);
  });
});

describe("assertKnowledgeMatchTopN", () => {
  it("passes when top-N IDs match in order", () => {
    expect(
      assertKnowledgeMatchTopN(
        { ids: [42, 17, 3, 99] },
        { ids: [42, 17, 3], topN: 3 }
      ).pass
    ).toBe(true);
  });

  it("fails on mismatch and surfaces the diff", () => {
    const result = assertKnowledgeMatchTopN(
      { ids: [42, 99, 3] },
      { ids: [42, 17, 3], topN: 3 }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toContain("expected: [42, 17, 3]");
    expect(result.diff).toContain("observed: [42, 99, 3]");
  });
});

describe("assertEscalationSignals", () => {
  it("passes when signal types match (order-insensitive)", () => {
    expect(
      assertEscalationSignals(
        { signals: [{ type: "needs-attention" }, { type: "lesson" }] },
        { signals: ["lesson", "needs-attention"] }
      ).pass
    ).toBe(true);
  });

  it("fails when an extra signal is observed", () => {
    const result = assertEscalationSignals(
      {
        signals: [
          { type: "needs-attention" },
          { type: "lesson" },
          { type: "test-failure" },
        ],
      },
      { signals: ["needs-attention", "lesson"] }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toContain("test-failure");
  });

  it("fails when an expected signal is missing", () => {
    const result = assertEscalationSignals(
      { signals: [{ type: "needs-attention" }] },
      { signals: ["needs-attention", "lesson"] }
    );
    expect(result.pass).toBe(false);
  });
});
