import { describe, it, expect } from "vitest";
import { extractEngineerMessages } from "@/lib/engineer-tag-parser";

describe("extractEngineerMessages", () => {
  it("returns an empty array for input without [ENGINEER] tags", () => {
    expect(extractEngineerMessages("just a normal message")).toEqual([]);
  });

  it("extracts a single [ENGINEER] message", () => {
    const out = extractEngineerMessages(
      "[ENGINEER] noticed the dashboard score lags for shipped projects"
    );
    expect(out).toEqual([
      "noticed the dashboard score lags for shipped projects",
    ]);
  });

  it("trims surrounding whitespace", () => {
    const out = extractEngineerMessages(
      "[ENGINEER]    leading whitespace example   "
    );
    expect(out).toEqual(["leading whitespace example"]);
  });

  it("stops at a newline (treats subsequent line as separate content)", () => {
    const out = extractEngineerMessages(
      "[ENGINEER] first message\nThen some prose continuing the answer."
    );
    expect(out).toEqual(["first message"]);
  });

  it("extracts multiple [ENGINEER] tags from one response", () => {
    const out = extractEngineerMessages(`
      Here's what I'd like:
      [ENGINEER] fix the dashboard score for shipped projects
      Some prose between.
      [ENGINEER] also wire up the channel writeback so this gets persisted
    `);
    expect(out).toEqual([
      "fix the dashboard score for shipped projects",
      "also wire up the channel writeback so this gets persisted",
    ]);
  });

  it("ignores [ENGINEER] tags inside code blocks (heuristic: simple regex, not full markdown — current scope)", () => {
    // Documented limitation: the parser is regex-based, not markdown-aware.
    // A code-block-wrapped [ENGINEER] WILL be parsed. Listed here so the
    // limitation is visible in tests if anyone hits it.
    const out = extractEngineerMessages(
      "```\n[ENGINEER] this is a code-block example, not a real message\n```"
    );
    expect(out).toEqual([
      "this is a code-block example, not a real message",
    ]);
  });

  it("re-runs cleanly when called twice (regex lastIndex reset)", () => {
    const input = "[ENGINEER] something";
    expect(extractEngineerMessages(input)).toHaveLength(1);
    expect(extractEngineerMessages(input)).toHaveLength(1);
  });

  it("returns empty messages as empty array (filters them out)", () => {
    const out = extractEngineerMessages("[ENGINEER]   ");
    expect(out).toEqual([]);
  });
});
