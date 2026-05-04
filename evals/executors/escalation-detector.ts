/**
 * Phase 23.7 — escalation-detector kind executor.
 *
 * Loads the log file relative to the scenario JSON, calls
 * `detectEscalations`, and runs the signals asserter.
 */
import fs from "fs";
import path from "path";
import type { KindExecutor } from "../runner";
import type {
  EscalationInput,
  EscalationSignalsExpectation,
} from "../types";
import { detectEscalations } from "@/lib/escalation-detector";
import { assertEscalationSignals } from "../asserters";

export const escalationDetectorExecutor: KindExecutor = async (
  scenario,
  opts
) => {
  const input = scenario.input as EscalationInput;
  const expected = scenario.assert as EscalationSignalsExpectation;

  const scenarioDir = path.dirname(opts.scenarioPath);
  const logPath = path.resolve(scenarioDir, input.logFile);

  if (!fs.existsSync(logPath)) {
    return {
      pass: false,
      diff: `[escalation-detector] log file not found: ${logPath}`,
    };
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const signals = detectEscalations(content);
  return assertEscalationSignals({ signals }, expected);
};
