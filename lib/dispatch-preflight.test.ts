/**
 * Phase 26.1 — dispatch preflight tests.
 *
 * The preflight module is platform-agnostic: it takes `platform` and a
 * `whichTool` lookup function via the deps argument, so tests don't need
 * to mock `process.platform` or `child_process` globally.
 */
import { describe, it, expect } from "vitest";
import { checkDispatchPreflight } from "./dispatch-preflight";

function fakeWhich(found: Record<string, string>) {
  return async (name: string): Promise<string | null> => found[name] ?? null;
}

describe("checkDispatchPreflight", () => {
  describe("windows", () => {
    it("reports platform=windows and resolves wt.exe / bash / claude when all present", async () => {
      const result = await checkDispatchPreflight({
        platform: "win32",
        whichTool: fakeWhich({
          "wt.exe": "C:\\Users\\justi\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe",
          bash: "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          claude: "C:\\Users\\justi\\AppData\\Roaming\\npm\\claude.cmd",
        }),
      });

      expect(result.platform).toBe("windows");
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.tools["wt.exe"]).toContain("wt.exe");
      expect(result.tools.bash).toContain("bash");
      expect(result.tools.claude).toContain("claude");
    });

    it("lists missing tools when wt.exe is not found", async () => {
      const result = await checkDispatchPreflight({
        platform: "win32",
        whichTool: fakeWhich({
          bash: "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          claude: "C:\\Users\\justi\\AppData\\Roaming\\npm\\claude.cmd",
        }),
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toContain("wt.exe");
      expect(result.tools["wt.exe"]).toBeNull();
    });

    it("flags all three missing tools when PATH is empty", async () => {
      const result = await checkDispatchPreflight({
        platform: "win32",
        whichTool: fakeWhich({}),
      });

      expect(result.ok).toBe(false);
      expect(result.missing.sort()).toEqual(["bash", "claude", "wt.exe"]);
    });
  });

  describe("macos", () => {
    it("requires claude + osascript", async () => {
      const result = await checkDispatchPreflight({
        platform: "darwin",
        whichTool: fakeWhich({
          claude: "/opt/homebrew/bin/claude",
          osascript: "/usr/bin/osascript",
        }),
      });

      expect(result.platform).toBe("macos");
      expect(result.ok).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it("flags osascript missing", async () => {
      const result = await checkDispatchPreflight({
        platform: "darwin",
        whichTool: fakeWhich({ claude: "/opt/homebrew/bin/claude" }),
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["osascript"]);
    });
  });

  describe("linux", () => {
    it("requires claude + tmux + bash", async () => {
      const result = await checkDispatchPreflight({
        platform: "linux",
        whichTool: fakeWhich({
          claude: "/usr/local/bin/claude",
          tmux: "/usr/bin/tmux",
          bash: "/bin/bash",
        }),
      });

      expect(result.platform).toBe("linux");
      expect(result.ok).toBe(true);
    });

    it("flags tmux missing on linux (most common gap)", async () => {
      const result = await checkDispatchPreflight({
        platform: "linux",
        whichTool: fakeWhich({
          claude: "/usr/local/bin/claude",
          bash: "/bin/bash",
        }),
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toEqual(["tmux"]);
    });
  });
});
