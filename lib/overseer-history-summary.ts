/**
 * Phase 24.1 — outcome-history summary heuristic.
 *
 * Pure function: maps per-mode aggregations + a recent timeline into
 * a one-line natural-language summary the Overseer reads as input.
 * Intentionally a heuristic, not a model call — keeps the surrounding
 * tool fast, deterministic, and free of recursive Anthropic calls.
 *
 * The Overseer uses the summary as advisory context when proposing
 * dispatches. Examples it produces:
 *   "3 of last 3 audits returned no actionable signals."
 *   "5 of last 5 continues succeeded."
 *   "Continue mode has been failing — 3 of last 4 hit a blocker."
 */

export interface ByModeAggregation {
  count: number;
  /** Fraction of outcomes with outcome === "success". 0 if count is 0. */
  successRate: number;
  /** Signal types appearing in ≥50% of this mode's outcomes within the window. */
  recurringSignals: string[];
}

export interface OutcomeTimelineEntry {
  date: string;
  mode: string;
  outcome: string;
  signals: string[];
}

export interface SummaryInput {
  byMode: Record<string, ByModeAggregation>;
  recentTimeline: OutcomeTimelineEntry[];
  totalDispatches: number;
}

const MIN_DATA_FOR_SUMMARY = 2;
const REPEATED_AUDIT_THRESHOLD = 3;
const CONTINUE_SUCCESS_RATE = 0.7;
const CONTINUE_SUCCESS_MIN_COUNT = 3;
const CONTINUE_FAILURE_RATE = 0.3;
const CONTINUE_FAILURE_MIN_COUNT = 2;

export function generateSummary(input: SummaryInput): string {
  if (input.totalDispatches < MIN_DATA_FOR_SUMMARY) {
    return "";
  }

  const parts: string[] = [];

  const audit = input.byMode.audit;
  if (
    audit &&
    audit.count >= REPEATED_AUDIT_THRESHOLD &&
    audit.recurringSignals.length === 0
  ) {
    parts.push(
      `${audit.count} of last ${audit.count} audits returned no actionable signals.`
    );
  }

  const cont = input.byMode.continue;
  if (cont && cont.count >= CONTINUE_SUCCESS_MIN_COUNT && cont.successRate >= CONTINUE_SUCCESS_RATE) {
    const pct = Math.round(cont.successRate * 100);
    parts.push(`${pct}% of recent continues (${cont.count}) succeeded.`);
  } else if (
    cont &&
    cont.count >= CONTINUE_FAILURE_MIN_COUNT &&
    cont.successRate <= CONTINUE_FAILURE_RATE
  ) {
    parts.push(
      `Continue mode has been failing — ${cont.count} recent continues with ${Math.round(
        cont.successRate * 100
      )}% success.`
    );
  }

  // Surface a recurring blocker pattern across modes if it shows up.
  const recurringByMode: Record<string, string[]> = {};
  for (const [mode, agg] of Object.entries(input.byMode)) {
    if (agg.recurringSignals.length > 0) {
      recurringByMode[mode] = agg.recurringSignals;
    }
  }
  if (Object.keys(recurringByMode).length > 0) {
    const pairs = Object.entries(recurringByMode)
      .map(([mode, sigs]) => `${mode}: ${sigs.join(", ")}`)
      .join("; ");
    parts.push(`Recurring signals — ${pairs}.`);
  }

  return parts.join(" ");
}
