/**
 * Phase 23.6 — CLI tests.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { parseArgs, main } from "./run";

const ORIG_API_KEY = process.env.ANTHROPIC_API_KEY;
const stdoutWrites: string[] = [];
const stderrWrites: string[] = [];
const origStdoutWrite = process.stdout.write;
const origStderrWrite = process.stderr.write;

beforeEach(() => {
  stdoutWrites.length = 0;
  stderrWrites.length = 0;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderrWrites.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;
  if (ORIG_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIG_API_KEY;
  }
});

describe("parseArgs", () => {
  it("defaults to replay mode", () => {
    expect(parseArgs([])).toEqual({ record: false });
  });

  it("flips to record on --record", () => {
    expect(parseArgs(["--record"]).record).toBe(true);
  });

  it("captures --scenario filter", () => {
    expect(parseArgs(["--scenario=overseer/foo"]).scenario).toBe(
      "overseer/foo"
    );
  });

  it("captures --kind filter", () => {
    expect(parseArgs(["--kind=overseer-tool-sequence"]).kind).toBe(
      "overseer-tool-sequence"
    );
  });
});

describe("CLI main", () => {
  it("returns 0 when scenarios root is empty", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "evals-cli-empty-"));
    try {
      const code = await main([], { scenariosDir: empty });
      expect(code).toBe(0);
      expect(stdoutWrites.join("")).toContain("no scenarios found");
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it("returns non-zero with a clear error when --record is set without ANTHROPIC_API_KEY", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const code = await main(["--record"]);
    expect(code).toBe(1);
    expect(stderrWrites.join("")).toMatch(/ANTHROPIC_API_KEY required/);
  });
});
