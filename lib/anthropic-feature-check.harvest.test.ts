import { describe, it, expect } from "vitest";
import { extractAnthropicTags } from "@/lib/knowledge-harvester";

describe("extractAnthropicTags", () => {
  it("returns empty array on content with no tags", () => {
    expect(extractAnthropicTags("nothing here", "session.md")).toEqual([]);
  });

  it("extracts a single tag with name and context", () => {
    const content = `Some prose.

[ANTHROPIC] Sub-Agents: A new Task tool subagent type for code review.

More prose afterward.`;
    const out = extractAnthropicTags(content, "/tmp/session.md");
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("Sub-Agents");
    expect(out[0].context).toContain("Task tool subagent");
    expect(out[0].sourceFile).toBe("/tmp/session.md");
  });

  it("extracts multiple tags in one document", () => {
    const content = `[ANTHROPIC] Prompt Caching: Anthropic shipped cache_control. Worth integrating.

Some other prose.

[ANTHROPIC] Batch API: New /v1/messages/batches endpoint.`;
    const out = extractAnthropicTags(content);
    expect(out.length).toBe(2);
    expect(out.map((c) => c.name)).toEqual(["Prompt Caching", "Batch API"]);
  });

  it("handles tag without colon (whole line as name)", () => {
    const content = `[ANTHROPIC] worktree isolation flag added`;
    const out = extractAnthropicTags(content);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("worktree isolation flag added");
  });

  it("does not bleed across [LESSON] boundaries", () => {
    const content = `[ANTHROPIC] Stop Hook: New hook variant.
Prose for Anthropic tag.

[LESSON] Always run prisma generate before typecheck.

More lesson body.

[ANTHROPIC] Citations: Source-citation feature now in API.`;
    const out = extractAnthropicTags(content);
    expect(out.length).toBe(2);
    expect(out[0].context).not.toContain("prisma generate");
  });
});
