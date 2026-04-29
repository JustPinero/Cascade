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

describe("contract — SP and dashboard regex share one source of truth (Phase 15)", () => {
  it("the exported DISPATCH_TAG_EXAMPLE is the literal embedded in TOOL_PATH_SYSTEM_PROMPT", async () => {
    const { TOOL_PATH_SYSTEM_PROMPT, DISPATCH_TAG_EXAMPLE } = await import(
      "@/app/api/overseer/chat/route"
    );
    // Both sides import the same const. If anyone edits the example
    // in route.ts, this assertion still holds; if anyone hardcodes
    // a divergent string in the SP literal, this fails. That's the
    // contract.
    expect(TOOL_PATH_SYSTEM_PROMPT).toContain(DISPATCH_TAG_EXAMPLE);
  });

  it("the example, with real values swapped in, parses through extractDispatchActions", async () => {
    const { DISPATCH_TAG_EXAMPLE } = await import(
      "@/app/api/overseer/chat/route"
    );
    const realInput = DISPATCH_TAG_EXAMPLE.replace(
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
  });
});
