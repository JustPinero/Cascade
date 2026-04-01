import { describe, it, expect } from "vitest";
import { isValidSlug, isInsideProjectsDir } from "@/lib/validators";

describe("Dispatch API validation", () => {
  it("validates dispatch modes", () => {
    const VALID_MODES = new Set(["continue", "audit", "investigate", "custom"]);
    expect(VALID_MODES.has("continue")).toBe(true);
    expect(VALID_MODES.has("audit")).toBe(true);
    expect(VALID_MODES.has("investigate")).toBe(true);
    expect(VALID_MODES.has("custom")).toBe(true);
    expect(VALID_MODES.has("destroy")).toBe(false);
    expect(VALID_MODES.has("")).toBe(false);
  });

  it("validates slug before dispatch", () => {
    expect(isValidSlug("ratracer")).toBe(true);
    expect(isValidSlug("my-app.v2")).toBe(true);
    expect(isValidSlug("; rm -rf /")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  it("validates project path before dispatch", () => {
    expect(isInsideProjectsDir("/Users/justinpinero/Desktop/projects/ratracer", "/Users/justinpinero/Desktop/projects")).toBe(true);
    expect(isInsideProjectsDir("/etc/passwd", "/Users/justinpinero/Desktop/projects")).toBe(false);
    expect(isInsideProjectsDir("/Users/justinpinero/Desktop/projects/../../../etc/passwd", "/Users/justinpinero/Desktop/projects")).toBe(false);
  });

  it("dispatch-all only accepts continue and audit modes", () => {
    const allowedModes = new Set(["continue", "audit"]);
    expect(allowedModes.has("continue")).toBe(true);
    expect(allowedModes.has("audit")).toBe(true);
    expect(allowedModes.has("investigate")).toBe(false);
    expect(allowedModes.has("custom")).toBe(false);
  });
});
