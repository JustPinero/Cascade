import { describe, it, expect } from "vitest";
import { hasSessionMemory, type SessionMemoryState } from "@/lib/session-memory";

describe("hasSessionMemory", () => {
  it("returns false when activeFlow is null AND workingMemory is empty", () => {
    const state: SessionMemoryState = { activeFlow: null, workingMemory: {} };
    expect(hasSessionMemory(state)).toBe(false);
  });

  it("returns true when only activeFlow is set", () => {
    const state: SessionMemoryState = {
      activeFlow: "inventory_walk",
      workingMemory: {},
    };
    expect(hasSessionMemory(state)).toBe(true);
  });

  it("returns true when only workingMemory has keys", () => {
    const state: SessionMemoryState = {
      activeFlow: null,
      workingMemory: { covered: { medipal: { progress: 40 } } },
    };
    expect(hasSessionMemory(state)).toBe(true);
  });

  it("returns true when both activeFlow and workingMemory keys are present", () => {
    const state: SessionMemoryState = {
      activeFlow: "dispatch_planning",
      workingMemory: { proposedDispatches: [] },
    };
    expect(hasSessionMemory(state)).toBe(true);
  });
});
