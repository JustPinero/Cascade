import { describe, it, expect } from "vitest";
import { detectPlatform, getLaunchMethod } from "./platform";

describe("platform", () => {
  describe("detectPlatform", () => {
    it("returns a valid platform string", () => {
      const platform = detectPlatform();
      expect(["macos", "linux", "windows"]).toContain(platform);
    });

    it("returns macos on darwin", () => {
      // Current test environment — this will pass on macOS
      if (process.platform === "darwin") {
        expect(detectPlatform()).toBe("macos");
      }
    });
  });

  describe("getLaunchMethod", () => {
    it("returns osascript for macos", () => {
      expect(getLaunchMethod("macos")).toBe("osascript");
    });

    it("returns tmux-direct for linux", () => {
      expect(getLaunchMethod("linux")).toBe("tmux-direct");
    });

    it("returns tmux-direct for windows (WSL2)", () => {
      expect(getLaunchMethod("windows")).toBe("tmux-direct");
    });
  });
});
