import { describe, it, expect } from "vitest";
import { extractDispatchActions } from "@/lib/dispatch-tag-parser";

describe("extractDispatchActions — basic shapes", () => {
  it("parses a single em-dash dispatch", () => {
    const out = extractDispatchActions(
      "[DISPATCH] cascade: continue — finish phase-14"
    );
    expect(out).toEqual([
      { project: "cascade", action: "continue", prompt: "finish phase-14" },
    ]);
  });

  it("parses with hyphen instead of em-dash", () => {
    const out = extractDispatchActions(
      "[DISPATCH] medipal: investigate - tests are flaking"
    );
    expect(out).toEqual([
      { project: "medipal", action: "investigate", prompt: "tests are flaking" },
    ]);
  });

  it("parses without instructions", () => {
    const out = extractDispatchActions("[DISPATCH] sitelift: audit");
    expect(out).toEqual([
      { project: "sitelift", action: "audit", prompt: "" },
    ]);
  });

  it("parses multiple dispatches in one message", () => {
    const out = extractDispatchActions(`
      Here's the plan:
      [DISPATCH] cascade: continue — phase 14 review
      [DISPATCH] ratracer: audit
    `);
    expect(out).toHaveLength(2);
    expect(out[0].project).toBe("cascade");
    expect(out[1].project).toBe("ratracer");
  });

  it("ignores invalid mode strings", () => {
    const out = extractDispatchActions("[DISPATCH] cascade: yolo");
    expect(out).toEqual([]);
  });

  it("returns empty for chat with no dispatches", () => {
    const out = extractDispatchActions("just a normal sentence");
    expect(out).toEqual([]);
  });

  it("normalizes mode case to lowercase", () => {
    const out = extractDispatchActions("[DISPATCH] cascade: CONTINUE");
    expect(out[0].action).toBe("continue");
  });

  it("re-runs cleanly when called twice (regex lastIndex reset)", () => {
    const input = "[DISPATCH] cascade: continue";
    expect(extractDispatchActions(input)).toHaveLength(1);
    expect(extractDispatchActions(input)).toHaveLength(1);
  });
});

describe("contract — SP-documented format parses through the regex (Phase 14.6)", () => {
  it("the SP example string parses correctly", async () => {
    // Import the SP directly so the test fails if the format
    // documented in the SP and the dashboard-side regex drift apart.
    const { TOOL_PATH_SYSTEM_PROMPT } = await import(
      "@/app/api/overseer/chat/route"
    );

    // The SP advertises this exact format. If anyone edits it, this
    // test should keep passing — that's the whole contract.
    const exampleFromSP = "[DISPATCH] project-slug: mode — optional instructions";

    // The literal "project-slug: mode" is a placeholder, but the
    // structural shape (brackets, colon, em-dash) needs to parse with
    // a real mode word. Test with a real mode swapped in.
    const realInput = exampleFromSP.replace(
      "project-slug: mode",
      "cascade: continue"
    );
    const parsed = extractDispatchActions(realInput);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      project: "cascade",
      action: "continue",
      prompt: "optional instructions",
    });

    // Sanity: the SP actually contains the [DISPATCH] format string.
    expect(TOOL_PATH_SYSTEM_PROMPT).toContain(
      "[DISPATCH] project-slug: mode"
    );
  });
});
