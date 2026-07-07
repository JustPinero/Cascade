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
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildWebhookCommand } from "./install-hooks";

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
