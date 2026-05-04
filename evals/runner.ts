/**
 * Phase 23.6 — scenario discovery + execution.
 *
 * Walks evals/scenarios/<kind>/*.json and dispatches each fixture to
 * the matching asserter. The runner stays minimal — its job is
 * orchestration; asserters do the comparison work.
 */
import fs from "fs";
import path from "path";
import type { Scenario, ScenarioKind, RunResult, RecorderMode } from "./types";

const KNOWN_KINDS: ScenarioKind[] = [
  "overseer-tool-sequence",
  "knowledge-match-top-n",
  "escalation-signals",
];

export interface DiscoveredScenarios {
  // kind → array of resolved file paths
  [kind: string]: string[];
}

export function discoverScenarios(
  scenariosRootDir: string
): DiscoveredScenarios {
  const out: DiscoveredScenarios = {};
  if (!fs.existsSync(scenariosRootDir)) return out;
  for (const kind of fs.readdirSync(scenariosRootDir)) {
    const kindDir = path.join(scenariosRootDir, kind);
    if (!fs.statSync(kindDir).isDirectory()) continue;
    const files: string[] = [];
    walkJsonFiles(kindDir, files);
    if (files.length > 0) out[kind] = files;
  }
  return out;
}

function walkJsonFiles(dir: string, accum: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walkJsonFiles(path.join(dir, entry.name), accum);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      accum.push(path.join(dir, entry.name));
    }
  }
}

export function loadScenario(filePath: string): Scenario {
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Scenario;
  if (!parsed.name) {
    throw new Error(`[runner] ${filePath}: missing required field 'name'`);
  }
  if (!KNOWN_KINDS.includes(parsed.kind)) {
    throw new Error(
      `[runner] ${filePath}: unknown kind '${parsed.kind}'. ` +
        `Expected one of: ${KNOWN_KINDS.join(", ")}`
    );
  }
  if (!parsed.input) {
    throw new Error(`[runner] ${filePath}: missing required field 'input'`);
  }
  if (!parsed.assert) {
    throw new Error(`[runner] ${filePath}: missing required field 'assert'`);
  }
  return parsed;
}

export interface RunOptions {
  /** Scenario file path, used to locate sibling recordings dir. */
  scenarioPath: string;
  mode: RecorderMode;
  /** Optional regex; only run scenarios whose name matches. */
  scenarioFilter?: RegExp;
  /** Optional kind filter. */
  kindFilter?: ScenarioKind;
}

/**
 * Executor lookup: each kind owns its own runner module which does the
 * setup + invocation + observation extraction. Implementations land in
 * 23.7 alongside the fixtures (overseer needs DB seeding, matcher
 * needs the matcher import, detector needs the regex import).
 *
 * For 23.6 (scaffolding), we expose the dispatch table type and a
 * placeholder that throws if no executor is registered. The fixtures
 * slice (23.7) registers real executors via `registerKindExecutor`.
 */
export type KindExecutor = (
  scenario: Scenario,
  opts: RunOptions
) => Promise<{ pass: boolean; diff?: string }>;

const executors = new Map<ScenarioKind, KindExecutor>();

export function registerKindExecutor(
  kind: ScenarioKind,
  executor: KindExecutor
): void {
  executors.set(kind, executor);
}

export function clearKindExecutors(): void {
  executors.clear();
}

export async function runScenario(
  scenario: Scenario,
  opts: RunOptions
): Promise<RunResult> {
  const start = performance.now();
  const executor = executors.get(scenario.kind);
  if (!executor) {
    return {
      scenarioName: scenario.name,
      kind: scenario.kind,
      pass: false,
      diff: `[runner] no executor registered for kind '${scenario.kind}'`,
      durationMs: 0,
    };
  }
  try {
    const result = await executor(scenario, opts);
    return {
      scenarioName: scenario.name,
      kind: scenario.kind,
      pass: result.pass,
      diff: result.diff,
      durationMs: Math.round(performance.now() - start),
    };
  } catch (err) {
    return {
      scenarioName: scenario.name,
      kind: scenario.kind,
      pass: false,
      diff: `executor threw: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Math.round(performance.now() - start),
    };
  }
}
