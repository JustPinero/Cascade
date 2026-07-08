/**
 * Phase 23.2 / 41.5 — Stop hook command shape tests.
 *
 * The shipped Stop hook command is bash and runs in every managed
 * project's session. Phase 41.5 moved the webhook POST into the
 * canonical script (session-complete-hook.sh, spool-on-failure); the
 * install command now invokes that script. These tests assert the
 * invocation shape AND that the script preserves the idempotencyKey
 * round-trip, so a future edit can't silently drop it.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildWebhookCommand,
  copyCanonicalScript,
  processProject,
} from "./install-hooks";

describe("install-hooks — buildWebhookCommand", () => {
  it("invokes the canonical spool-on-failure hook script", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain("session-complete-hook.sh");
    expect(cmd).toMatch(/^bash /);
  });

  it("passes the project path ($PWD) to the script", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain('"$PWD"');
  });

  it("passes the configured port to the script", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain("3000");
    const cmd4001 = buildWebhookCommand("4001");
    expect(cmd4001).toContain("4001");
  });

  it("backgrounds the invocation with & so the hook returns immediately", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd.trim().endsWith("&")).toBe(true);
  });

  it("silences output", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain("> /dev/null 2>&1");
  });
});

describe("install-hooks — canonical hook script", () => {
  const scriptPath = path.resolve(__dirname, "session-complete-hook.sh");

  it("exists and is the script buildWebhookCommand targets", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(buildWebhookCommand("3000")).toContain("session-complete-hook.sh");
  });

  it("round-trips CASCADE_DISPATCH_ID as idempotencyKey (Phase 23.2 guard)", () => {
    const src = fs.readFileSync(scriptPath, "utf-8");
    expect(src).toContain("CASCADE_DISPATCH_ID");
    expect(src).toContain("idempotencyKey");
  });

  it("posts projectPath to the session-complete webhook", () => {
    const src = fs.readFileSync(scriptPath, "utf-8");
    expect(src).toContain("projectPath");
    expect(src).toContain("/api/webhook/session-complete");
  });

  it("spools to an env-configurable path outside any repo by default", () => {
    const src = fs.readFileSync(scriptPath, "utf-8");
    expect(src).toContain("CASCADE_WEBHOOK_SPOOL");
    expect(src).toContain(".cascade/webhook-spool.jsonl");
  });
});

/**
 * Fix 41.D9 — the canonical Stop-hook script is referenced by a
 * $HOME-relative path so it survives being committed into
 * cross-machine-synced settings.json, and install-hooks copies the
 * script to that $HOME-stable location (~/.cascade) so it resolves on
 * any machine. All home/target/source paths are injectable so these
 * tests never touch the real ~/.cascade.
 */
describe("install-hooks — fix 41.D9 portable hook path", () => {
  const scratchDirs: string[] = [];

  function scratch(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    scratchDirs.push(dir);
    return dir;
  }

  function scratchSource(content = "#!/usr/bin/env bash\necho hook\n"): string {
    const dir = scratch("cascade-src-");
    const src = path.join(dir, "session-complete-hook.sh");
    fs.writeFileSync(src, content);
    return src;
  }

  afterEach(() => {
    while (scratchDirs.length) {
      const dir = scratchDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildWebhookCommand references a $HOME-relative script path, not an absolute /Users path", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain('"$HOME/.cascade/session-complete-hook.sh"');
    expect(cmd).not.toMatch(/\/Users\//);
  });

  it("hook command still backgrounds, passes $PWD and the port, and silences output", () => {
    expect(buildWebhookCommand("4001")).toBe(
      'bash "$HOME/.cascade/session-complete-hook.sh" "$PWD" 4001 > /dev/null 2>&1 &'
    );
  });

  it("copyCanonicalScript copies the source into <home>/.cascade and it matches, executable", () => {
    const home = scratch("cascade-home-");
    const source = scratchSource("#!/usr/bin/env bash\necho v1\n");
    copyCanonicalScript({ home, sourcePath: source });
    const target = path.join(home, ".cascade", "session-complete-hook.sh");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf-8")).toBe(
      fs.readFileSync(source, "utf-8")
    );
    expect(fs.statSync(target).mode & 0o111).not.toBe(0);
  });

  it("copyCanonicalScript is idempotent and refreshes when the source changes", () => {
    const home = scratch("cascade-home-");
    const source = scratchSource("#!/usr/bin/env bash\necho v1\n");
    const target = path.join(home, ".cascade", "session-complete-hook.sh");

    copyCanonicalScript({ home, sourcePath: source });
    fs.writeFileSync(source, "#!/usr/bin/env bash\necho v2\n");
    // Run twice — no throw, target ends up matching the latest source.
    expect(() => {
      copyCanonicalScript({ home, sourcePath: source });
      copyCanonicalScript({ home, sourcePath: source });
    }).not.toThrow();
    expect(fs.readFileSync(target, "utf-8")).toBe("#!/usr/bin/env bash\necho v2\n");
  });

  it("processProject places the script at the scratch home before writing settings", () => {
    const home = scratch("cascade-home-");
    const source = scratchSource();
    const projectDir = scratch("cascade-proj-");

    processProject(projectDir, { home, sourcePath: source });

    const target = path.join(home, ".cascade", "session-complete-hook.sh");
    expect(fs.existsSync(target)).toBe(true);

    const settings = JSON.parse(
      fs.readFileSync(path.join(projectDir, ".claude", "settings.json"), "utf-8")
    );
    const cmd = settings.hooks.Stop[0].hooks[0].command as string;
    expect(cmd).toContain('"$HOME/.cascade/session-complete-hook.sh"');
    expect(cmd).not.toMatch(/\/Users\//);
  });

  it("replaces an existing old Cascade Stop hook in place — no duplicate entry", () => {
    const home = scratch("cascade-home-");
    const source = scratchSource();
    const projectDir = scratch("cascade-proj-");
    const settingsDir = path.join(projectDir, ".claude");
    fs.mkdirSync(settingsDir, { recursive: true });
    // Prior Cascade Stop hook with the NON-portable absolute script path.
    fs.writeFileSync(
      path.join(settingsDir, "settings.json"),
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: "",
                hooks: [
                  {
                    type: "command",
                    command:
                      'mkdir -p "$PWD/.claude/sessions" && bash "/Users/justinpinero/Desktop/projects/Cascade/scripts/session-complete-hook.sh" "$PWD" 3000 > /dev/null 2>&1 &',
                    description:
                      "Cascade: save session log and notify dashboard",
                  },
                ],
              },
            ],
          },
        },
        null,
        2
      )
    );

    processProject(projectDir, { home, sourcePath: source });

    const settings = JSON.parse(
      fs.readFileSync(path.join(settingsDir, "settings.json"), "utf-8")
    );
    expect(settings.hooks.Stop).toHaveLength(1);
    const cmd = settings.hooks.Stop[0].hooks[0].command as string;
    expect(cmd).toContain('"$HOME/.cascade/session-complete-hook.sh"');
    expect(cmd).not.toContain("/Users/");
  });
});
