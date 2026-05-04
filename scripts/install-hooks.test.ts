/**
 * Phase 23.2 — Stop hook command shape tests.
 *
 * The shipped Stop hook command is bash and runs in every managed
 * project's session. These tests assert the shape so a future edit
 * to install-hooks.ts can't silently drop the idempotencyKey
 * round-trip.
 */
import { describe, it, expect } from "vitest";
import { buildWebhookCommand } from "./install-hooks";

describe("install-hooks — buildWebhookCommand", () => {
  it("targets the configured port", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain("http://localhost:3000/api/webhook/session-complete");
  });

  it("posts projectPath unconditionally", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain('\\"projectPath\\":\\"$PWD\\"');
  });

  it("conditionally appends idempotencyKey when CASCADE_DISPATCH_ID is set", () => {
    const cmd = buildWebhookCommand("3000");
    // Bash ${VAR:+text} expands to text only when VAR is non-empty.
    expect(cmd).toContain("${CASCADE_DISPATCH_ID:+");
    expect(cmd).toContain('\\"idempotencyKey\\":\\"$CASCADE_DISPATCH_ID\\"');
  });

  it("backgrounds the curl with & so the hook returns immediately", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd.trim().endsWith("&")).toBe(true);
  });

  it("silences curl output", () => {
    const cmd = buildWebhookCommand("3000");
    expect(cmd).toContain("> /dev/null 2>&1");
  });
});
