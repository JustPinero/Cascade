import { describe, it, expect } from "vitest";
import { parseCIConclusion, type CIStatus } from "./ci-status";

describe("ci-status", () => {
  describe("parseCIConclusion", () => {
    it("returns pass for success conclusion", () => {
      expect(parseCIConclusion("success")).toBe("pass");
    });

    it("returns fail for failure conclusion", () => {
      expect(parseCIConclusion("failure")).toBe("fail");
    });

    it("returns fail for cancelled", () => {
      expect(parseCIConclusion("cancelled")).toBe("fail");
    });

    it("returns none for empty string", () => {
      expect(parseCIConclusion("")).toBe("none");
    });

    it("returns none for null", () => {
      expect(parseCIConclusion(null as unknown as string)).toBe("none");
    });

    it("returns pending for in_progress", () => {
      expect(parseCIConclusion("in_progress")).toBe("pending");
    });
  });
});
