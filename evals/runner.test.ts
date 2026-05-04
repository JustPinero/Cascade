/**
 * Phase 23.6 — runner tests.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  discoverScenarios,
  loadScenario,
  runScenario,
  registerKindExecutor,
  clearKindExecutors,
} from "./runner";

let cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  cleanup = [];
  clearKindExecutors();
});

function mkScenarioTree(rootName: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `evals-runner-${rootName}-`));
  cleanup.push(root);
  return root;
}

describe("discoverScenarios", () => {
  it("returns an empty object when the root doesn't exist", () => {
    const result = discoverScenarios(
      path.join(os.tmpdir(), "nonexistent-evals-dir-xxx")
    );
    expect(result).toEqual({});
  });

  it("groups files by kind directory", () => {
    const root = mkScenarioTree("group");
    fs.mkdirSync(path.join(root, "overseer-tool-sequence"));
    fs.writeFileSync(
      path.join(root, "overseer-tool-sequence", "foo.json"),
      "{}"
    );
    fs.mkdirSync(path.join(root, "knowledge-match-top-n"));
    fs.writeFileSync(
      path.join(root, "knowledge-match-top-n", "bar.json"),
      "{}"
    );
    const result = discoverScenarios(root);
    expect(Object.keys(result).sort()).toEqual([
      "knowledge-match-top-n",
      "overseer-tool-sequence",
    ]);
    expect(result["overseer-tool-sequence"]).toHaveLength(1);
    expect(result["knowledge-match-top-n"]).toHaveLength(1);
  });

  it("walks nested directories under a kind", () => {
    const root = mkScenarioTree("nested");
    const sub = path.join(root, "escalation-signals", "logs");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "deep.json"), "{}");
    const result = discoverScenarios(root);
    expect(result["escalation-signals"]).toHaveLength(1);
  });
});

describe("loadScenario", () => {
  it("parses a valid scenario file", () => {
    const root = mkScenarioTree("load");
    const file = path.join(root, "ok.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        name: "ok",
        kind: "overseer-tool-sequence",
        input: { messages: [] },
        assert: {},
      })
    );
    const result = loadScenario(file);
    expect(result.name).toBe("ok");
  });

  it("throws on missing required field", () => {
    const root = mkScenarioTree("missing");
    const file = path.join(root, "bad.json");
    fs.writeFileSync(file, JSON.stringify({ name: "no-kind", input: {}, assert: {} }));
    expect(() => loadScenario(file)).toThrow(/unknown kind/);
  });

  it("throws on unknown kind", () => {
    const root = mkScenarioTree("unknown");
    const file = path.join(root, "bad.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        name: "x",
        kind: "made-up-kind",
        input: {},
        assert: {},
      })
    );
    expect(() => loadScenario(file)).toThrow(/unknown kind/);
  });
});

describe("runScenario", () => {
  it("dispatches to the registered executor and returns its result", async () => {
    registerKindExecutor("overseer-tool-sequence", async (s) => {
      return { pass: true };
    });
    const result = await runScenario(
      {
        name: "test",
        kind: "overseer-tool-sequence",
        input: { messages: [] } as never,
        assert: {} as never,
      },
      { scenarioPath: "/tmp/test.json", mode: "replay" }
    );
    expect(result.pass).toBe(true);
    expect(result.scenarioName).toBe("test");
  });

  it("returns pass:false when no executor is registered", async () => {
    const result = await runScenario(
      {
        name: "test",
        kind: "overseer-tool-sequence",
        input: { messages: [] } as never,
        assert: {} as never,
      },
      { scenarioPath: "/tmp/test.json", mode: "replay" }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toMatch(/no executor registered/);
  });

  it("returns pass:false with the thrown message when an executor throws", async () => {
    registerKindExecutor("overseer-tool-sequence", async () => {
      throw new Error("simulated failure");
    });
    const result = await runScenario(
      {
        name: "test",
        kind: "overseer-tool-sequence",
        input: { messages: [] } as never,
        assert: {} as never,
      },
      { scenarioPath: "/tmp/test.json", mode: "replay" }
    );
    expect(result.pass).toBe(false);
    expect(result.diff).toMatch(/simulated failure/);
  });
});
