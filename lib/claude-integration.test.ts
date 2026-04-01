import { describe, it, expect } from "vitest";
import {
  generateKnowledgeBlock,
  hasKnowledgeReference,
  patchClaudeMd,
} from "./claude-integration";

describe("claude-integration", () => {
  it("generates knowledge block with relative path", () => {
    const block = generateKnowledgeBlock(
      "/Users/me/cascade",
      "/Users/me/projects/my-app"
    );
    expect(block).toContain("## Knowledge Base");
    expect(block).toContain("manifest.md");
    expect(block).toContain("[LESSON]");
  });

  it("detects existing knowledge reference", () => {
    const content = `# My Project
## Knowledge Base
Check manifest. Tag with [LESSON].`;
    expect(hasKnowledgeReference(content)).toBe(true);
  });

  it("returns false when no knowledge reference", () => {
    expect(hasKnowledgeReference("# My Project\nSome content")).toBe(false);
  });

  it("patches CLAUDE.md with knowledge block", () => {
    const original = "# My Project\n\n## Stack\nNext.js";
    const patched = patchClaudeMd(
      original,
      "/Users/me/cascade",
      "/Users/me/projects/my-app"
    );
    expect(patched).toContain("## Knowledge Base");
    expect(patched).toContain("manifest.md");
    expect(patched).toContain(original.trim());
  });

  it("does not double-patch", () => {
    const original = "# My Project\n## Knowledge Base\nCheck [LESSON] tags.";
    const patched = patchClaudeMd(
      original,
      "/Users/me/cascade",
      "/Users/me/projects/my-app"
    );
    expect(patched).toBe(original);
  });
});
