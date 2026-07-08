/**
 * Phase 40 [P3] — outcome-driven dispatch recommendations.
 *
 * Pure heuristic (no model call), mirroring overseer-history-summary.ts:
 * deterministic, fast, and free of recursive Anthropic calls. The Overseer
 * already reads outcome history via query_outcome_history; this surfaces the
 * same patterns to the *human* operator on the dashboard.
 *
 * Thresholds are intentionally shared with the Overseer summary heuristic so
 * the dashboard and the AI advisor never disagree about what the data says.
 */

export type RecommendationKind =
  | "low-signal-mode" // a diagnostic mode keeps coming back clean
  | "failing-mode" // a forward mode keeps failing
  | "recurring-blocker"; // a blocker signal recurs — needs the human

export interface Recommendation {
  projectSlug: string;
  kind: RecommendationKind;
  /** The mode the recommendation is about (audit, continue, …). */
  mode: string;
  /** Mode to switch to, when the rule has a concrete suggestion. */
  suggestedMode?: string;
  /** Human-readable, dashboard-ready sentence. */
  message: string;
  /** How many dispatches inform this recommendation. */
  count: number;
  /** info = an optimization; warn = something is going wrong. */
  severity: "info" | "warn";
}

/** Minimal outcome shape the engine needs — signals already parsed. */
export interface OutcomeRow {
  mode: string;
  /** success | blocker | attention-needed | test-failure | unknown */
  outcome: string;
  /** Escalation signal types detected during the session. */
  signals: string[];
  /**
   * Phase 41.2 — goal evaluator verdict. true = a separate model
   * confirmed the /goal condition against the transcript; false = the
   * evaluator contradicted the session; null/undefined = no verdict
   * (ad-hoc dispatch, older CLI, or no marker in the log).
   */
  goalAchieved?: boolean | null;
}

export interface ProjectOutcomes {
  slug: string;
  /** Recent outcomes within the caller's window, any order. */
  outcomes: OutcomeRow[];
}

// Shared with overseer-history-summary.ts / overseer-tools-outcome-history.ts.
const DIAGNOSTIC_MODES = ["audit", "investigate"];
const REPEATED_DIAGNOSTIC_THRESHOLD = 3;
const CONTINUE_FAILURE_RATE = 0.3;
const CONTINUE_FAILURE_MIN_COUNT = 2;
const RECURRING_SIGNAL_THRESHOLD = 0.5;

/** Signal types that mean a human needs to look, not just a mode switch. */
const BLOCKER_SIGNALS = new Set([
  "needs-attention",
  "human-todo",
  "test-failure",
]);

// Phase 41.2 — goal-verified successes outrank self-reported ones.
// A success the goal evaluator confirmed counts fully; a bare
// self-report counts at a discount; a self-report the evaluator
// CONTRADICTED (goalAchieved === false) counts as a failure.
const GOAL_VERIFIED_SUCCESS_WEIGHT = 1;
const SELF_REPORTED_SUCCESS_WEIGHT = 0.6;

/**
 * How much a single outcome row contributes to a mode's success score.
 * Exported so dashboards/tests can assert the ordering:
 * goal-verified > self-reported > contradicted (0) = non-success (0).
 */
export function successWeight(row: OutcomeRow): number {
  if (row.outcome !== "success") return 0;
  if (row.goalAchieved === true) return GOAL_VERIFIED_SUCCESS_WEIGHT;
  if (row.goalAchieved === false) return 0;
  return SELF_REPORTED_SUCCESS_WEIGHT;
}

interface ModeStats {
  count: number;
  successes: number;
  /** Phase 41.2 — successes weighted by goal verification. */
  weightedSuccesses: number;
  signalSets: string[][];
}

function statsByMode(outcomes: OutcomeRow[]): Map<string, ModeStats> {
  const byMode = new Map<string, ModeStats>();
  for (const o of outcomes) {
    let stats = byMode.get(o.mode);
    if (!stats) {
      stats = { count: 0, successes: 0, weightedSuccesses: 0, signalSets: [] };
      byMode.set(o.mode, stats);
    }
    stats.count += 1;
    if (o.outcome === "success") stats.successes += 1;
    stats.weightedSuccesses += successWeight(o);
    stats.signalSets.push(o.signals);
  }
  return byMode;
}

/** Signal types appearing in ≥50% of this mode's outcomes. */
function recurringSignals(signalSets: string[][]): string[] {
  if (signalSets.length === 0) return [];
  const counts = new Map<string, number>();
  for (const sigs of signalSets) {
    for (const s of new Set(sigs)) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  const threshold = signalSets.length * RECURRING_SIGNAL_THRESHOLD;
  return Array.from(counts.entries())
    .filter(([, n]) => n >= threshold)
    .map(([sig]) => sig)
    .sort();
}

function recommendationsForProject(project: ProjectOutcomes): Recommendation[] {
  const recs: Recommendation[] = [];
  const byMode = statsByMode(project.outcomes);

  for (const [mode, stats] of byMode) {
    const recurring = recurringSignals(stats.signalSets);

    // Rule: low-signal diagnostic mode — repeated, all clean, nothing found.
    if (
      DIAGNOSTIC_MODES.includes(mode) &&
      stats.count >= REPEATED_DIAGNOSTIC_THRESHOLD &&
      stats.successes === stats.count &&
      recurring.length === 0
    ) {
      recs.push({
        projectSlug: project.slug,
        kind: "low-signal-mode",
        mode,
        suggestedMode: "continue",
        message: `${mode} on ${project.slug}: ${stats.count} dispatches, 0 findings — switch to continue?`,
        count: stats.count,
        severity: "info",
      });
    }

    // Rule: failing forward mode — continue keeps hitting walls.
    // Phase 41.2 — scored on goal-weighted successes, so a mode kept
    // afloat only by unverified self-reports trips the rule earlier
    // than one whose successes the goal evaluator confirmed.
    if (
      mode === "continue" &&
      stats.count >= CONTINUE_FAILURE_MIN_COUNT &&
      stats.weightedSuccesses / stats.count <= CONTINUE_FAILURE_RATE
    ) {
      const pct = Math.round((stats.weightedSuccesses / stats.count) * 100);
      recs.push({
        projectSlug: project.slug,
        kind: "failing-mode",
        mode,
        suggestedMode: "investigate",
        message: `continue on ${project.slug} is failing — ${pct}% goal-weighted success over ${stats.count} — try investigate?`,
        count: stats.count,
        severity: "warn",
      });
    }

    // Rule: recurring blocker-class signal — surface it for the human.
    const blockers = recurring.filter((s) => BLOCKER_SIGNALS.has(s));
    if (blockers.length > 0) {
      recs.push({
        projectSlug: project.slug,
        kind: "recurring-blocker",
        mode,
        message: `${project.slug} keeps surfacing ${blockers.join(", ")} in ${mode} (${stats.count} dispatches) — needs your attention.`,
        count: stats.count,
        severity: "warn",
      });
    }
  }

  return recs;
}

/**
 * Map recent per-project outcome rows into actionable recommendations.
 * Pure and deterministic. Projects with nothing notable yield nothing.
 */
export function computeRecommendations(
  projects: ProjectOutcomes[]
): Recommendation[] {
  return projects.flatMap(recommendationsForProject);
}
