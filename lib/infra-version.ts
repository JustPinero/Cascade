import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Infrastructure-version health dimension (phase 41.7).
 *
 * Per-project infrastructure state as a first-class health signal, built
 * on 41.4's findings-array plumbing:
 *
 *   1. Plugin version — which coqui-kickoff plugin the machine has
 *      installed (machine-level, same for every project; surfaced once).
 *   2. Migration state — `v4`, `v3.5-remnants` (project-local machinery
 *      that SHADOWS a plugin-provided name, or a session-context/
 *      secret-scan hook still wired into project settings.json), or
 *      `no-kickoff` (no project-local machinery at all).
 *   3. Workspace trust — whether the trust dialog was accepted for this
 *      project. Untrusted workspaces silently ignore project allow-lists
 *      in dispatched sessions (observed on sharpesanimalhouse during the
 *      2026-07-07 migration), so a declined dialog is a real hazard.
 *
 * Every ~/.claude read is path-injectable (options → env vars → real
 * ~/.claude defaults) so tests run entirely against filesystem fixtures
 * and never touch the live plugin symlink or ~/.claude.json.
 */

// ---------------------------------------------------------------------------
// Plugin-provided machinery names (coqui-kickoff v3.5 "Step 1" kit).
//
// v3.5 shipped this machinery as project-local files. v4 moved it into the
// plugin (a symlink under ~/.claude/skills/coqui-kickoff), so a project-local
// entry with any of these EXACT names now shadows the plugin — a remnant.
// Custom-named machinery (e.g. sharpes' audit-flags/run-tests) is NOT a
// remnant.
// ---------------------------------------------------------------------------

const PLUGIN_SKILL_NAMES = new Set([
  "test-audit",
  "bughunt",
  "optimize",
  "drift-audit",
  "course-correction",
  "coding-standards",
  "session-handoff",
  "pre-deploy",
]);

const PLUGIN_AGENT_NAMES = new Set(["audit-runner", "code-reviewer", "debugger"]);

const PLUGIN_COMMAND_NAMES = new Set([
  "run-audits",
  "test-audit",
  "bughunt",
  "optimize",
  "drift-audit",
  "handoff",
  "course-correct",
  "phase-complete",
  "ci-update",
  "defer",
  "activate",
  "pre-deploy",
]);

/** Hook script basenames whose presence in project settings.json is a v3.5 remnant. */
const REMNANT_HOOK_MARKERS = ["session-context", "secret-scan"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationState = "v4" | "v3.5-remnants" | "no-kickoff";

export type WorkspaceTrust = "accepted" | "not-accepted" | "unknown";

export interface PluginVersionInfo {
  /** True when the plugin.json was found and parsed. */
  installed: boolean;
  /** Semver string from plugin.json, or null when not installed. */
  version: string | null;
}

export interface InfraVersionInfo {
  plugin: PluginVersionInfo;
  migrationState: MigrationState;
  /**
   * Kind-prefixed remnant identifiers (e.g. `skill:bughunt`,
   * `agent:debugger`, `command:handoff`, `hook:session-context`). Empty
   * unless migrationState is `v3.5-remnants`.
   */
  remnants: string[];
  workspaceTrust: WorkspaceTrust;
}

export interface InfraVersionOptions {
  /**
   * Path to the coqui-kickoff plugin.json. Falls back to
   * `CASCADE_PLUGIN_JSON_PATH` then the real
   * `~/.claude/skills/coqui-kickoff/.claude-plugin/plugin.json`.
   */
  pluginJsonPath?: string;
  /**
   * Path to `~/.claude.json` (workspace-trust source). Falls back to
   * `CASCADE_CLAUDE_CONFIG_PATH` then the real `~/.claude.json`.
   */
  claudeConfigPath?: string;
}

// ---------------------------------------------------------------------------
// Path resolution — options win, then env, then real ~/.claude defaults.
// ---------------------------------------------------------------------------

function resolvePluginJsonPath(options: InfraVersionOptions): string {
  return (
    options.pluginJsonPath ??
    process.env.CASCADE_PLUGIN_JSON_PATH ??
    path.join(
      os.homedir(),
      ".claude",
      "skills",
      "coqui-kickoff",
      ".claude-plugin",
      "plugin.json"
    )
  );
}

function resolveClaudeConfigPath(options: InfraVersionOptions): string {
  return (
    options.claudeConfigPath ??
    process.env.CASCADE_CLAUDE_CONFIG_PATH ??
    path.join(os.homedir(), ".claude.json")
  );
}

// ---------------------------------------------------------------------------
// Signal 1 — plugin version.
// ---------------------------------------------------------------------------

async function readPluginVersion(
  pluginJsonPath: string
): Promise<PluginVersionInfo> {
  try {
    const raw = await fs.readFile(pluginJsonPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const version =
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { version?: unknown }).version === "string"
        ? (parsed as { version: string }).version
        : null;
    return { installed: version !== null, version };
  } catch {
    return { installed: false, version: null };
  }
}

// ---------------------------------------------------------------------------
// Signal 2 — migration state / v3.5 remnants.
// ---------------------------------------------------------------------------

/** Basename with any single extension stripped (bughunt.md → bughunt). */
function bareName(entry: string): string {
  return entry.replace(/\.[^.]+$/, "");
}

async function detectShadowingEntries(
  dir: string,
  pluginNames: Set<string>,
  kind: string
): Promise<{ entries: number; remnants: string[] }> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return { entries: 0, remnants: [] };
  }
  const visible = names.filter((n) => !n.startsWith("."));
  const remnants = visible
    .map(bareName)
    .filter((name) => pluginNames.has(name))
    .map((name) => `${kind}:${name}`);
  return { entries: visible.length, remnants };
}

/** Deep-scan a settings.json hooks tree for a remnant hook command marker. */
function collectHookMarkers(settings: unknown): string[] {
  const markers = new Set<string>();
  const commands: string[] = [];

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "command" && typeof value === "string") {
          commands.push(value);
        } else {
          walk(value);
        }
      }
    }
  };

  if (settings && typeof settings === "object" && "hooks" in settings) {
    walk((settings as { hooks: unknown }).hooks);
  }

  for (const command of commands) {
    for (const marker of REMNANT_HOOK_MARKERS) {
      if (command.includes(marker)) {
        markers.add(`hook:${marker}`);
      }
    }
  }
  return [...markers];
}

async function detectHookRemnants(claudeDir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(
      path.join(claudeDir, "settings.json"),
      "utf-8"
    );
    return collectHookMarkers(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function detectMigrationState(
  projectPath: string
): Promise<{ migrationState: MigrationState; remnants: string[] }> {
  const claudeDir = path.join(projectPath, ".claude");

  const [skills, agents, commands, hookRemnants] = await Promise.all([
    detectShadowingEntries(
      path.join(claudeDir, "skills"),
      PLUGIN_SKILL_NAMES,
      "skill"
    ),
    detectShadowingEntries(
      path.join(claudeDir, "agents"),
      PLUGIN_AGENT_NAMES,
      "agent"
    ),
    detectShadowingEntries(
      path.join(claudeDir, "commands"),
      PLUGIN_COMMAND_NAMES,
      "command"
    ),
    detectHookRemnants(claudeDir),
  ]);

  const remnants = [
    ...skills.remnants,
    ...agents.remnants,
    ...commands.remnants,
    ...hookRemnants,
  ];

  if (remnants.length > 0) {
    return { migrationState: "v3.5-remnants", remnants };
  }

  // No remnants. Any project-local machinery at all → migrated to v4 with
  // custom-named machinery; none → this project never had kickoff machinery.
  const hasMachinery =
    skills.entries > 0 || agents.entries > 0 || commands.entries > 0;
  return {
    migrationState: hasMachinery ? "v4" : "no-kickoff",
    remnants: [],
  };
}

// ---------------------------------------------------------------------------
// Signal 3 — workspace trust.
// ---------------------------------------------------------------------------

async function readWorkspaceTrust(
  claudeConfigPath: string,
  projectPath: string
): Promise<WorkspaceTrust> {
  let config: unknown;
  try {
    config = JSON.parse(await fs.readFile(claudeConfigPath, "utf-8"));
  } catch {
    return "unknown";
  }

  if (!config || typeof config !== "object" || !("projects" in config)) {
    return "unknown";
  }
  const projects = (config as { projects: unknown }).projects;
  if (!projects || typeof projects !== "object") {
    return "unknown";
  }

  // ~/.claude.json keys projects by absolute path; match resolved paths so
  // trailing-slash / relative differences don't produce a false unknown.
  const resolved = path.resolve(projectPath);
  const map = projects as Record<string, unknown>;
  const entry =
    map[projectPath] ??
    map[resolved] ??
    Object.entries(map).find(
      ([key]) => path.resolve(key) === resolved
    )?.[1];

  if (!entry || typeof entry !== "object") {
    return "unknown";
  }
  const accepted = (entry as { hasTrustDialogAccepted?: unknown })
    .hasTrustDialogAccepted;
  if (accepted === true) return "accepted";
  if (accepted === false) return "not-accepted";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

/**
 * Compute the infrastructure-version dimension for one project. Never
 * throws — every read degrades to `not-installed` / `no-kickoff` /
 * `unknown` rather than failing the surrounding health computation.
 */
export async function computeInfraVersion(
  projectPath: string,
  options: InfraVersionOptions = {}
): Promise<InfraVersionInfo> {
  const [plugin, migration, workspaceTrust] = await Promise.all([
    readPluginVersion(resolvePluginJsonPath(options)),
    detectMigrationState(projectPath),
    readWorkspaceTrust(resolveClaudeConfigPath(options), projectPath),
  ]);

  return {
    plugin,
    migrationState: migration.migrationState,
    remnants: migration.remnants,
    workspaceTrust,
  };
}
