#!/usr/bin/env npx tsx
/**
 * Install Claude Code Stop hooks on all managed projects.
 *
 * The Stop hook:
 * 1. Copies .claude/handoff.md to .claude/sessions/{timestamp}.md (session log)
 * 2. Pings Cascade's webhook so it auto-scans the project
 *
 * Usage:
 *   npx tsx scripts/install-hooks.ts           # install hooks
 *   npx tsx scripts/install-hooks.ts --dry-run  # preview changes
 */

import fs from "fs";
import path from "path";

const PROJECTS_DIR =
  process.env.PROJECTS_DIR || path.resolve(__dirname, "../../");
const CASCADE_PORT = process.env.CASCADE_PORT || "3000";
const DRY_RUN = process.argv.includes("--dry-run");

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    description?: string;
  }>;
}

interface SettingsJson {
  permissions?: Record<string, unknown>;
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

const SESSION_LOG_COMMAND = `mkdir -p "$PWD/.claude/sessions" && if [ -f "$PWD/.claude/handoff.md" ]; then cp "$PWD/.claude/handoff.md" "$PWD/.claude/sessions/$(date +%Y-%m-%dT%H-%M-%S).md"; fi`;
const WEBHOOK_COMMAND = `curl -s -X POST http://localhost:${CASCADE_PORT}/api/webhook/session-complete -H 'Content-Type: application/json' -d "{\\"projectPath\\":\\"$PWD\\"}" > /dev/null 2>&1 &`;

const STOP_HOOK: HookEntry = {
  matcher: "",
  hooks: [
    {
      type: "command",
      command: `${SESSION_LOG_COMMAND} && ${WEBHOOK_COMMAND}`,
      description: "Cascade: save session log and notify dashboard",
    },
  ],
};

/**
 * Fix malformed hook entries that use the old flat format:
 *   { "type": "command", "command": "...", "matcher": "Bash" }
 * Convert to correct nested format:
 *   { "matcher": "Bash", "hooks": [{ "type": "command", "command": "..." }] }
 */
function fixHookFormats(hooks: Record<string, unknown[]>): {
  fixed: Record<string, HookEntry[]>;
  repairsCount: number;
} {
  let repairsCount = 0;
  const fixed: Record<string, HookEntry[]> = {};

  for (const [event, entries] of Object.entries(hooks)) {
    fixed[event] = [];
    for (const entry of entries) {
      const e = entry as Record<string, unknown>;
      // Check if this is the old flat format (has "type" and "command" at top level, no "hooks" array)
      if (e.type && e.command && !e.hooks) {
        // Convert to correct format
        fixed[event].push({
          matcher: (e.matcher as string) || "",
          hooks: [
            {
              type: e.type as string,
              command: e.command as string,
              description: e.description as string | undefined,
            },
          ],
        });
        repairsCount++;
      } else if (e.hooks && Array.isArray(e.hooks)) {
        // Already correct format
        fixed[event].push(e as unknown as HookEntry);
      } else {
        // Unknown format, keep as-is
        fixed[event].push(e as unknown as HookEntry);
      }
    }
  }

  return { fixed, repairsCount };
}

function isCascadeStopHook(entry: HookEntry): boolean {
  return entry.hooks.some(
    (h) =>
      h.description?.includes("Cascade") ||
      h.command.includes("session-complete")
  );
}

function processProject(projectDir: string): {
  name: string;
  action: string;
  error?: string;
} {
  const name = path.basename(projectDir);
  const settingsDir = path.join(projectDir, ".claude");
  const settingsPath = path.join(settingsDir, "settings.json");

  // Read existing settings or start fresh
  let settings: SettingsJson = {};
  if (fs.existsSync(settingsPath)) {
    try {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      settings = JSON.parse(raw);
    } catch (e) {
      return {
        name,
        action: "SKIPPED",
        error: `Invalid JSON in ${settingsPath}: ${e}`,
      };
    }
  }

  // Ensure hooks object exists
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Fix any malformed hook entries (old flat format → nested format)
  const { fixed, repairsCount } = fixHookFormats(
    settings.hooks as Record<string, unknown[]>
  );
  if (repairsCount > 0) {
    settings.hooks = fixed;
  }

  // Ensure Stop array exists
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  // Check if Cascade hook already exists
  const existingIdx = settings.hooks.Stop.findIndex(isCascadeStopHook);
  if (existingIdx >= 0) {
    // Update in place
    settings.hooks.Stop[existingIdx] = STOP_HOOK;
  } else {
    // Append
    settings.hooks.Stop.push(STOP_HOOK);
  }

  if (DRY_RUN) {
    return { name, action: "WOULD INSTALL" };
  }

  // Ensure .claude directory exists
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  // Write updated settings
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  const action = repairsCount > 0
    ? `INSTALLED (repaired ${repairsCount} malformed hooks)`
    : "INSTALLED";
  return { name, action };
}

function main() {
  console.log(
    DRY_RUN ? "=== DRY RUN ===" : "=== Installing Cascade Stop Hooks ==="
  );
  console.log(`Projects dir: ${PROJECTS_DIR}`);
  console.log(`Cascade port: ${CASCADE_PORT}\n`);

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`Projects directory not found: ${PROJECTS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const results: Array<{ name: string; action: string; error?: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    // Skip Cascade itself — it doesn't need a Stop hook
    if (entry.name === "Cascade" || entry.name === "cascade") continue;

    const projectDir = path.join(PROJECTS_DIR, entry.name);
    const result = processProject(projectDir);
    results.push(result);
    const icon =
      result.action === "INSTALLED"
        ? "+"
        : result.action === "WOULD INSTALL"
          ? "~"
          : "!";
    const suffix = result.error ? ` (${result.error})` : "";
    console.log(`  ${icon} ${result.name}: ${result.action}${suffix}`);
  }

  const installed = results.filter((r) => r.action === "INSTALLED").length;
  const skipped = results.filter((r) => r.action === "SKIPPED").length;
  const wouldInstall = results.filter(
    (r) => r.action === "WOULD INSTALL"
  ).length;

  console.log(
    `\n${DRY_RUN ? `Would install: ${wouldInstall}` : `Installed: ${installed}`}, Skipped: ${skipped}, Total: ${results.length}`
  );
}

main();
