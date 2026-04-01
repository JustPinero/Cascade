import { describe, it, expect } from "vitest";
import { extractKickoff } from "./wizard-prompt";

describe("extractKickoff", () => {
  it("extracts content between markers", () => {
    const response = `Here's your kickoff:

---KICKOFF-START---
# My Project

## Stack
Next.js + TypeScript
---KICKOFF-END---

Let me know if you need changes.`;

    const result = extractKickoff(response);
    expect(result).toContain("# My Project");
    expect(result).toContain("## Stack");
    expect(result).not.toContain("KICKOFF-START");
    expect(result).not.toContain("Let me know");
  });

  it("returns null when no markers", () => {
    expect(extractKickoff("No markers here")).toBeNull();
  });

  it("returns null when only start marker", () => {
    expect(
      extractKickoff("---KICKOFF-START---\nContent without end")
    ).toBeNull();
  });

  it("returns null when markers are reversed", () => {
    expect(
      extractKickoff("---KICKOFF-END---\n---KICKOFF-START---")
    ).toBeNull();
  });
});
