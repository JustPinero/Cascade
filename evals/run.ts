/**
 * Phase 23.6 — eval CLI entry point.
 *
 *   pnpm eval                              # replay all scenarios
 *   pnpm eval --scenario=overseer/foo      # filter by name fragment
 *   pnpm eval --kind=knowledge-match-top-n # filter by kind
 *   pnpm eval:refresh                      # re-record against live API
 *   pnpm eval:refresh --scenario=...       # refresh one scenario
 *
 * Replay mode runs offline — no API key required. Record mode requires
 * ANTHROPIC_API_KEY (validated up front so we don't half-record).
 */
import path from "path";
import {
  discoverScenarios,
  loadScenario,
  runScenario,
  registerKindExecutor,
} from "./runner";
import type { ScenarioKind } from "./types";
import { knowledgeMatcherExecutor } from "./executors/knowledge-matcher";
import { escalationDetectorExecutor } from "./executors/escalation-detector";
import { overseerExecutor } from "./executors/overseer";

// Phase 23.7 — kind-to-executor registration. Each executor is a
// pure module; registering at CLI startup keeps test code (which
// imports `runner.ts` for unit tests) free of these heavier deps.
function registerExecutors(): void {
  registerKindExecutor("knowledge-match-top-n", knowledgeMatcherExecutor);
  registerKindExecutor("escalation-signals", escalationDetectorExecutor);
  registerKindExecutor("overseer-tool-sequence", overseerExecutor);
}

interface CliArgs {
  record: boolean;
  scenario?: string;
  kind?: ScenarioKind;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { record: false };
  for (const arg of argv) {
    if (arg === "--record") {
      out.record = true;
    } else if (arg.startsWith("--scenario=")) {
      out.scenario = arg.slice("--scenario=".length);
    } else if (arg.startsWith("--kind=")) {
      out.kind = arg.slice("--kind=".length) as ScenarioKind;
    }
  }
  return out;
}

const DEFAULT_SCENARIOS_DIR = path.resolve(__dirname, "scenarios");

export interface MainOptions {
  /** Override the scenarios root. Useful for tests. */
  scenariosDir?: string;
}

export async function main(
  argv: string[],
  options: MainOptions = {}
): Promise<number> {
  registerExecutors();
  const args = parseArgs(argv);
  const scenariosDir = options.scenariosDir ?? DEFAULT_SCENARIOS_DIR;

  if (args.record && !process.env.ANTHROPIC_API_KEY) {
    process.stderr.write(
      "[evals] ANTHROPIC_API_KEY required for --record (live API mode)\n"
    );
    return 1;
  }

  const discovered = discoverScenarios(scenariosDir);

  let totalScenarios = 0;
  for (const files of Object.values(discovered)) totalScenarios += files.length;

  if (totalScenarios === 0) {
    process.stdout.write(
      "[evals] no scenarios found under evals/scenarios/ — exiting 0\n"
    );
    return 0;
  }

  const filter = args.scenario ? new RegExp(args.scenario) : undefined;

  let pass = 0;
  let fail = 0;
  const failures: Array<{ name: string; diff?: string }> = [];

  for (const [kindStr, files] of Object.entries(discovered)) {
    if (args.kind && kindStr !== args.kind) continue;
    for (const file of files) {
      let scenario;
      try {
        scenario = loadScenario(file);
      } catch (err) {
        process.stderr.write(
          `[evals] failed to load ${file}: ${
            err instanceof Error ? err.message : String(err)
          }\n`
        );
        fail++;
        continue;
      }
      if (filter && !filter.test(`${kindStr}/${scenario.name}`)) continue;

      const result = await runScenario(scenario, {
        scenarioPath: file,
        mode: args.record ? "record" : "replay",
        scenarioFilter: filter,
        kindFilter: args.kind,
      });
      if (result.pass) {
        pass++;
        process.stdout.write(`  ✓ ${kindStr}/${scenario.name} (${result.durationMs}ms)\n`);
      } else {
        fail++;
        failures.push({ name: `${kindStr}/${scenario.name}`, diff: result.diff });
        process.stdout.write(`  × ${kindStr}/${scenario.name}\n`);
      }
    }
  }

  process.stdout.write(`\n${pass} passed, ${fail} failed\n`);

  if (failures.length > 0) {
    process.stdout.write("\nFailures:\n");
    for (const f of failures) {
      process.stdout.write(`\n  ${f.name}\n`);
      if (f.diff) {
        process.stdout.write(
          f.diff
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n") + "\n"
        );
      }
    }
  }

  return fail > 0 ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
