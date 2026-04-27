import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  detectsStopHook,
  detectsPostCompactHook,
  detectsPreToolUseHook,
  detectsPostToolUseHook,
  detectsUserPromptSubmitHook,
  detectsSlashCommands,
  detectsSkills,
  detectsSubAgentUsage,
  detectsAgentTeams,
  detectsMCPServers,
  detectsAutoMemory,
  detectsPlanModeUsage,
  detectsStatusLine,
  detectsIDEIntegration,
  detectsBackgroundTaskUsage,
  detectsWorktreeAgents,
  detectsPromptCaching,
  detectsExtendedThinking,
  detectsBatchAPI,
  detectsFilesAPI,
  detectsCitations,
  loadDetectorInput,
  DETECTOR_REGISTRY,
  type DetectorInput,
} from "@/lib/anthropic-feature-detectors";
import fs from "fs/promises";
import path from "path";
import os from "os";

function blankInput(overrides: Partial<DetectorInput> = {}): DetectorInput {
  return {
    projectPath: "/tmp/test-project",
    claudeMd: "",
    settingsJson: null,
    packageJson: null,
    hasCommandsDir: false,
    hasSkillsDir: false,
    hasIDEDir: false,
    codeContents: "",
    ...overrides,
  };
}

describe("DETECTOR_REGISTRY", () => {
  it("exports exactly 21 detectors (every feature in the seed)", () => {
    expect(Object.keys(DETECTOR_REGISTRY).length).toBe(21);
  });

  it("every registry entry is a callable function", () => {
    for (const fn of Object.values(DETECTOR_REGISTRY)) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("hook detectors (settings.json)", () => {
  it("detectsStopHook positive when hooks.Stop is present", () => {
    const r = detectsStopHook(
      blankInput({ settingsJson: { hooks: { Stop: [{}] } } }),
    );
    expect(r.detected).toBe(true);
    expect(r.signal).toContain("Stop");
  });

  it("detectsStopHook negative when settings.json missing", () => {
    expect(detectsStopHook(blankInput()).detected).toBe(false);
  });

  it("detectsPostCompactHook reads PostCompact entry", () => {
    expect(
      detectsPostCompactHook(
        blankInput({ settingsJson: { hooks: { PostCompact: "x" } } }),
      ).detected,
    ).toBe(true);
  });

  it("detectsPreToolUseHook reads PreToolUse entry", () => {
    expect(
      detectsPreToolUseHook(
        blankInput({ settingsJson: { hooks: { PreToolUse: "x" } } }),
      ).detected,
    ).toBe(true);
  });

  it("detectsPostToolUseHook reads PostToolUse entry", () => {
    expect(
      detectsPostToolUseHook(
        blankInput({ settingsJson: { hooks: { PostToolUse: "x" } } }),
      ).detected,
    ).toBe(true);
  });

  it("detectsUserPromptSubmitHook reads UserPromptSubmit entry", () => {
    expect(
      detectsUserPromptSubmitHook(
        blankInput({ settingsJson: { hooks: { UserPromptSubmit: "x" } } }),
      ).detected,
    ).toBe(true);
  });
});

describe("filesystem-presence detectors", () => {
  it("detectsSlashCommands fires when commands dir exists", () => {
    expect(
      detectsSlashCommands(blankInput({ hasCommandsDir: true })).detected,
    ).toBe(true);
  });

  it("detectsSkills fires when skills dir exists", () => {
    expect(detectsSkills(blankInput({ hasSkillsDir: true })).detected).toBe(true);
  });

  it("detectsIDEIntegration fires when .vscode/.idea present", () => {
    expect(
      detectsIDEIntegration(blankInput({ hasIDEDir: true })).detected,
    ).toBe(true);
  });
});

describe("settings-flag detectors", () => {
  it("detectsMCPServers fires when mcpServers is an object", () => {
    expect(
      detectsMCPServers(
        blankInput({ settingsJson: { mcpServers: { x: {} } } }),
      ).detected,
    ).toBe(true);
  });

  it("detectsMCPServers does NOT fire when mcpServers is null", () => {
    expect(
      detectsMCPServers(blankInput({ settingsJson: { mcpServers: null } }))
        .detected,
    ).toBe(false);
  });

  it("detectsStatusLine fires on any statusLine value", () => {
    expect(
      detectsStatusLine(blankInput({ settingsJson: { statusLine: "echo X" } }))
        .detected,
    ).toBe(true);
  });
});

describe("CLAUDE.md keyword detectors", () => {
  it("detectsSubAgentUsage fires on Task tool mention", () => {
    expect(
      detectsSubAgentUsage(
        blankInput({ claudeMd: "We use the Task tool to spawn explorers." }),
      ).detected,
    ).toBe(true);
  });

  it("detectsAgentTeams fires on agent team mention", () => {
    expect(
      detectsAgentTeams(blankInput({ claudeMd: "Agent teams pattern: lead + ..." }))
        .detected,
    ).toBe(true);
  });

  it("detectsAutoMemory fires on MEMORY.md mention", () => {
    expect(
      detectsAutoMemory(blankInput({ claudeMd: "We use MEMORY.md for context." }))
        .detected,
    ).toBe(true);
  });

  it("detectsPlanModeUsage fires on plan-mode mention", () => {
    expect(
      detectsPlanModeUsage(blankInput({ claudeMd: "Use Plan Mode for big design changes." }))
        .detected,
    ).toBe(true);
  });
});

describe("code-grep detectors", () => {
  it("detectsBackgroundTaskUsage fires on run_in_background", () => {
    expect(
      detectsBackgroundTaskUsage(
        blankInput({ codeContents: "Bash({ run_in_background: true })" }),
      ).detected,
    ).toBe(true);
  });

  it("detectsWorktreeAgents fires on isolation: \"worktree\"", () => {
    expect(
      detectsWorktreeAgents(
        blankInput({ codeContents: 'Agent({ isolation: "worktree" })' }),
      ).detected,
    ).toBe(true);
  });

  it("detectsPromptCaching fires on cache_control", () => {
    expect(
      detectsPromptCaching(
        blankInput({
          codeContents:
            'messages: [{ role: "user", content, cache_control: { type: "ephemeral" } }]',
        }),
      ).detected,
    ).toBe(true);
  });

  it("detectsExtendedThinking fires on thinking: marker", () => {
    expect(
      detectsExtendedThinking(
        blankInput({ codeContents: "thinking: { type: 'enabled' }" }),
      ).detected,
    ).toBe(true);
  });

  it("detectsBatchAPI fires on batches endpoint", () => {
    expect(
      detectsBatchAPI(
        blankInput({ codeContents: "fetch('/v1/messages/batches')" }),
      ).detected,
    ).toBe(true);
  });

  it("detectsFilesAPI fires on files endpoint", () => {
    expect(
      detectsFilesAPI(blankInput({ codeContents: "POST /v1/files" })).detected,
    ).toBe(true);
  });

  it("detectsCitations fires on citations: { enabled marker", () => {
    expect(
      detectsCitations(
        blankInput({ codeContents: "citations: { enabled: true }" }),
      ).detected,
    ).toBe(true);
  });
});

describe("loadDetectorInput (real fs)", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cascade-detect-"));
    await fs.mkdir(path.join(tmpDir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "CLAUDE.md"),
      "# Project\n\nUses Plan Mode and the Task tool.",
    );
    await fs.writeFile(
      path.join(tmpDir, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo" }] }],
          PostCompact: [{ matcher: "", hooks: [] }],
        },
        statusLine: "echo X",
      }),
    );
    await fs.mkdir(path.join(tmpDir, ".claude", "commands"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "lib"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "lib", "demo.ts"),
      'const r = { run_in_background: true, cache_control: { type: "ephemeral" } };',
    );
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads claude.md, settings.json, code, and dir flags from a real project", async () => {
    const input = await loadDetectorInput(tmpDir);
    expect(input.claudeMd).toContain("Plan Mode");
    expect(input.settingsJson?.hooks?.Stop).toBeDefined();
    expect(input.hasCommandsDir).toBe(true);
    expect(input.hasSkillsDir).toBe(false);
    expect(input.codeContents).toContain("run_in_background");
  });

  it("running every detector against a real project completes without throw", async () => {
    const input = await loadDetectorInput(tmpDir);
    const results: Record<string, boolean> = {};
    for (const [name, fn] of Object.entries(DETECTOR_REGISTRY)) {
      results[name] = fn(input).detected;
    }
    expect(results.detectsStopHook).toBe(true);
    expect(results.detectsPostCompactHook).toBe(true);
    expect(results.detectsStatusLine).toBe(true);
    expect(results.detectsSlashCommands).toBe(true);
    expect(results.detectsSkills).toBe(false);
    expect(results.detectsPlanModeUsage).toBe(true);
    expect(results.detectsSubAgentUsage).toBe(true);
    expect(results.detectsBackgroundTaskUsage).toBe(true);
    expect(results.detectsPromptCaching).toBe(true);
    expect(results.detectsBatchAPI).toBe(false);
  });
});
