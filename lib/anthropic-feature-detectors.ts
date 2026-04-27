import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";

/**
 * Pure-ish detector functions, one per known feature.
 *
 * Each detector takes a DetectorInput (the relevant contents of a
 * project pre-loaded by `loadDetectorInput`) and returns a
 * DetectorResult. Detectors never do I/O directly — that keeps them
 * fast, idempotent, and trivially testable.
 *
 * False positives and negatives are both tolerable: the audit is a
 * best-effort signal, not a compliance check. When in doubt, prefer
 * a slight over-detection — the proposer (phase 11.2) will gate.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SettingsJson {
  hooks?: Record<string, unknown>;
  mcpServers?: unknown;
  statusLine?: unknown;
  [k: string]: unknown;
}

export interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [k: string]: unknown;
}

export interface DetectorInput {
  projectPath: string;
  claudeMd: string; // empty string if missing
  settingsJson: SettingsJson | null;
  packageJson: PackageJson | null;
  hasCommandsDir: boolean;
  hasSkillsDir: boolean;
  hasIDEDir: boolean; // .vscode/ or .idea/
  /**
   * Concatenated text of the project's relevant source files.
   * Used for code-grep detectors (prompt caching, batch API, etc.).
   * Loaded with a hard cap to bound scan time.
   */
  codeContents: string;
}

export interface DetectorResult {
  detected: boolean;
  signal: string; // explanation of where the detector matched (or empty when not detected)
}

export type Detector = (input: DetectorInput) => DetectorResult;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const NEG: DetectorResult = { detected: false, signal: "" };

function fromSettings(
  hookName: string,
  input: DetectorInput,
): DetectorResult {
  const hook = input.settingsJson?.hooks?.[hookName];
  if (!hook) return NEG;
  return {
    detected: true,
    signal: `.claude/settings.json hooks.${hookName}`,
  };
}

function fromCodeMarkers(
  markers: string[],
  input: DetectorInput,
  source = "code",
): DetectorResult {
  for (const m of markers) {
    if (input.codeContents.includes(m)) {
      return { detected: true, signal: `${source}: ${m}` };
    }
  }
  return NEG;
}

function fromClaudeMdMarkers(
  markers: string[],
  input: DetectorInput,
): DetectorResult {
  if (!input.claudeMd) return NEG;
  for (const m of markers) {
    if (input.claudeMd.toLowerCase().includes(m.toLowerCase())) {
      return { detected: true, signal: `CLAUDE.md mentions "${m}"` };
    }
  }
  return NEG;
}

// -----------------------------------------------------------------------------
// Detectors — one per feature in knowledge/anthropic-features.md
// -----------------------------------------------------------------------------

export const detectsStopHook: Detector = (i) => fromSettings("Stop", i);
export const detectsPostCompactHook: Detector = (i) =>
  fromSettings("PostCompact", i);
export const detectsPreToolUseHook: Detector = (i) =>
  fromSettings("PreToolUse", i);
export const detectsPostToolUseHook: Detector = (i) =>
  fromSettings("PostToolUse", i);
export const detectsUserPromptSubmitHook: Detector = (i) =>
  fromSettings("UserPromptSubmit", i);

export const detectsSlashCommands: Detector = (i) =>
  i.hasCommandsDir
    ? { detected: true, signal: ".claude/commands/ directory present" }
    : NEG;

export const detectsSkills: Detector = (i) =>
  i.hasSkillsDir
    ? { detected: true, signal: ".claude/skills/ directory present" }
    : NEG;

export const detectsSubAgentUsage: Detector = (i) =>
  fromClaudeMdMarkers(["Task tool", "subagent_type", "sub-agent"], i);

export const detectsAgentTeams: Detector = (i) => {
  // Two strong signals: CLAUDE.md mentions agent teams,
  // OR the project's package.json has a flag enabling team mode
  // (Cascade's own Project.agentTeamsEnabled is a DB column, but
  // managed projects may still hint via CLAUDE.md).
  const md = fromClaudeMdMarkers(
    ["agent team", "dispatchTeam", "lead agent"],
    i,
  );
  if (md.detected) return md;
  return NEG;
};

export const detectsMCPServers: Detector = (i) => {
  if (
    i.settingsJson &&
    typeof i.settingsJson.mcpServers === "object" &&
    i.settingsJson.mcpServers !== null
  ) {
    return {
      detected: true,
      signal: ".claude/settings.json mcpServers configured",
    };
  }
  return NEG;
};

export const detectsAutoMemory: Detector = (i) =>
  fromClaudeMdMarkers(
    ["auto memory", "auto-memory", "MEMORY.md", "/memory/"],
    i,
  );

export const detectsPlanModeUsage: Detector = (i) =>
  fromClaudeMdMarkers(["plan mode", "EnterPlanMode", "ExitPlanMode"], i);

export const detectsStatusLine: Detector = (i) => {
  if (i.settingsJson?.statusLine) {
    return {
      detected: true,
      signal: ".claude/settings.json statusLine configured",
    };
  }
  return NEG;
};

export const detectsIDEIntegration: Detector = (i) =>
  i.hasIDEDir
    ? { detected: true, signal: ".vscode/ or .idea/ directory present" }
    : NEG;

export const detectsBackgroundTaskUsage: Detector = (i) =>
  fromCodeMarkers(["run_in_background", "runInBackground"], i);

export const detectsWorktreeAgents: Detector = (i) =>
  fromCodeMarkers(['isolation: "worktree"', "isolation:'worktree'"], i);

export const detectsPromptCaching: Detector = (i) =>
  fromCodeMarkers(['cache_control', '"ephemeral"'], i);

export const detectsExtendedThinking: Detector = (i) =>
  fromCodeMarkers(["thinking:", "extended-thinking"], i);

export const detectsBatchAPI: Detector = (i) =>
  fromCodeMarkers(["/v1/messages/batches", "messages.batches"], i);

export const detectsFilesAPI: Detector = (i) =>
  fromCodeMarkers(["/v1/files", "anthropic.files"], i);

export const detectsCitations: Detector = (i) =>
  fromCodeMarkers(["citations: { enabled", "citations:{enabled"], i);

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

export const DETECTOR_REGISTRY: Record<string, Detector> = {
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
};

// -----------------------------------------------------------------------------
// Input loader
// -----------------------------------------------------------------------------

const CODE_GREP_DIRS = ["lib", "src", "app", "scripts"] as const;
const CODE_GREP_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const CODE_GREP_MAX_BYTES = 2_000_000; // 2MB cap so we don't melt big monorepos
const CODE_GREP_MAX_DEPTH = 4;

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return null;
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function gatherCodeContents(projectPath: string): Promise<string> {
  const chunks: string[] = [];
  let totalBytes = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > CODE_GREP_MAX_DEPTH || totalBytes >= CODE_GREP_MAX_BYTES) return;
    let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (totalBytes >= CODE_GREP_MAX_BYTES) return;
      // Skip noisy dirs
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "build" ||
        entry.name === "coverage" ||
        entry.name === ".git"
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!CODE_GREP_EXTS.has(ext)) continue;
      const content = await readIfExists(full);
      if (!content) continue;
      const remaining = CODE_GREP_MAX_BYTES - totalBytes;
      const slice =
        content.length <= remaining ? content : content.slice(0, remaining);
      chunks.push(slice);
      totalBytes += slice.length;
    }
  }

  for (const subdir of CODE_GREP_DIRS) {
    const dir = path.join(projectPath, subdir);
    if (existsSync(dir)) {
      await walk(dir, 0);
    }
  }
  return chunks.join("\n");
}

/**
 * Build a DetectorInput by reading the project's filesystem once.
 * All 20 detectors share this input — single I/O pass per audit.
 */
export async function loadDetectorInput(
  projectPath: string,
): Promise<DetectorInput> {
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");
  const claudeMdLowerPath = path.join(projectPath, "claude.md");
  const claudeMd =
    (await readIfExists(claudeMdPath)) ??
    (await readIfExists(claudeMdLowerPath)) ??
    "";

  const settingsRaw = await readIfExists(
    path.join(projectPath, ".claude", "settings.json"),
  );
  let settingsJson: SettingsJson | null = null;
  if (settingsRaw) {
    try {
      settingsJson = JSON.parse(settingsRaw) as SettingsJson;
    } catch {
      settingsJson = null;
    }
  }

  const packageRaw = await readIfExists(path.join(projectPath, "package.json"));
  let packageJson: PackageJson | null = null;
  if (packageRaw) {
    try {
      packageJson = JSON.parse(packageRaw) as PackageJson;
    } catch {
      packageJson = null;
    }
  }

  const hasCommandsDir = await dirExists(
    path.join(projectPath, ".claude", "commands"),
  );
  const hasSkillsDir = await dirExists(
    path.join(projectPath, ".claude", "skills"),
  );
  const hasIDEDir =
    (await dirExists(path.join(projectPath, ".vscode"))) ||
    (await dirExists(path.join(projectPath, ".idea")));

  const codeContents = await gatherCodeContents(projectPath);

  return {
    projectPath,
    claudeMd,
    settingsJson,
    packageJson,
    hasCommandsDir,
    hasSkillsDir,
    hasIDEDir,
    codeContents,
  };
}
