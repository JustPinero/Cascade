/**
 * Phase 23.5.1 — shell-escape verifier.
 *
 * Asserts the architecture-level invariant Cascade relies on: prompts
 * go through a tmp file and are read back via `cat`, never inlined
 * into the shell command. The constructed cmd contains a `cat` of a
 * tmpfile path; the malicious payload lives in that file's contents,
 * not in the cmd. So even a prompt that would otherwise break out of
 * single quoting (`'; rm -rf /`) cannot reach the shell as a command.
 *
 * If a future refactor inlines prompts into the cmd, these tests
 * fire — by design.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

vi.mock("fs/promises", () => {
  const api = {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { default: api, ...api };
});

vi.mock("@/lib/file-utils", () => ({
  readIfExists: vi.fn(async () => "content"),
}));

vi.mock("@/lib/validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
  sanitizeForShell: vi.fn((s: string) => s),
}));

import { dispatchClaude } from "@/lib/claude-dispatcher";
import { createDispatchRig } from "@/tests/harness/dispatch-rig";
import type { DispatchRig } from "@/tests/harness/dispatch-rig.types";

let rig: DispatchRig | null = null;

afterEach(async () => {
  await rig?.dispose();
  rig = null;
  vi.clearAllMocks();
});

/**
 * Pull the cmd argument that the dispatcher passed to its shell. On
 * Linux/WSL2 the rig's spawn captures `("bash", ["-c", cmd], ...)`;
 * on macOS the cmd is embedded in an osascript invocation. Both keep
 * the cmd as a string we can introspect.
 */
function extractCmd(rig: DispatchRig): string {
  const records = rig.spawnRecords;
  expect(records.length).toBeGreaterThan(0);
  const rec = records[0];
  // bash path: rec.args = ["-c", cmd]
  if (rec.command === "bash" && rec.args.length >= 2) {
    return rec.args[1];
  }
  // osascript path: cmd is inside the AppleScript text in args
  if (rec.command === "osascript") {
    return rec.args.join(" ");
  }
  // fallback — concatenate everything for substring assertions
  return [rec.command, ...rec.args].join(" ");
}

describe("shell-escape verifier", () => {
  it("does not inline the prompt into the cmd — cat-from-tmpfile invariant holds", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    await dispatchClaude(rig.prisma, project, "harmless prompt for invariant check");

    const cmd = extractCmd(rig);
    // The cmd MUST reference a cat of a tmpfile path; the prompt
    // contents are NOT inlined.
    expect(cmd).toMatch(/cat\s+'[^']*cascade-prompt-[^']+'/);
    expect(cmd).not.toContain("harmless prompt for invariant check");
  });

  it("a single-quote injection attempt cannot break out of quoting", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    const malicious = `'; rm -rf /`;
    await dispatchClaude(rig.prisma, project, malicious);

    const cmd = extractCmd(rig);
    // The malicious string must NEVER appear in the cmd. It lives in
    // the tmpfile's contents, which the cmd reads via `cat`.
    expect(cmd).not.toContain("rm -rf");
    expect(cmd).not.toContain(malicious);
  });

  it("command substitution is not evaluated by the shell — it lives in the tmpfile only", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    const malicious = `$(touch /tmp/pwned-cascade-eval)`;
    await dispatchClaude(rig.prisma, project, malicious);

    const cmd = extractCmd(rig);
    // The substitution payload must not appear in the cmd at all.
    expect(cmd).not.toContain("touch /tmp/pwned-cascade-eval");
    expect(cmd).not.toContain("pwned-cascade-eval");
  });

  it("backticks in the prompt do not appear in the cmd", async () => {
    rig = await createDispatchRig({ concurrency: 1, fakeTimers: false });
    const project = await rig.createProject({
      slug: "alpha",
      path: "/p/alpha",
    });

    const malicious = "before `whoami` after";
    await dispatchClaude(rig.prisma, project, malicious);

    const cmd = extractCmd(rig);
    expect(cmd).not.toContain("`whoami`");
    expect(cmd).not.toContain("before `whoami` after");
  });
});
