import { describe, it, expect } from "vitest";
import { isPortraitSrcUsable } from "@/lib/portrait-fallback";

describe("isPortraitSrcUsable", () => {
  it("accepts a normal image path", () => {
    expect(isPortraitSrcUsable("/delamain.jpg")).toBe(true);
  });

  it("accepts an absolute URL", () => {
    expect(isPortraitSrcUsable("https://example.com/x.png")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isPortraitSrcUsable("")).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(isPortraitSrcUsable("   ")).toBe(false);
  });

  it("rejects null", () => {
    expect(isPortraitSrcUsable(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isPortraitSrcUsable(undefined)).toBe(false);
  });

  it("rejects non-string types", () => {
    expect(isPortraitSrcUsable(0)).toBe(false);
    expect(isPortraitSrcUsable(false)).toBe(false);
    expect(isPortraitSrcUsable({})).toBe(false);
  });
});
