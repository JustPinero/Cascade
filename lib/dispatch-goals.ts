/**
 * Phase 41.2 — goal-driven dispatch outcomes.
 *
 * Stop trusting sessions' self-reports. Every dispatch composed from a
 * request file gets a `/goal` completion condition derived from its
 * acceptance criteria (Claude Code v2.1.139+ keeps the session working
 * until a separate Haiku-class evaluator confirms the condition against
 * the transcript). This module owns both directions of that flow:
 *
 * - Composition: request-file markdown → a single `/goal <condition>`
 *   line that rides at the START of the composed dispatch prompt. The
 *   evaluator reads only the transcript, so the condition names checks
 *   whose output the session surfaces ("scripts/validate.sh exits 0,
 *   shown by running it"). On CLIs that predate /goal the line is just
 *   a prompt sentence, so the condition is written as meaningful plain
 *   instructions — it degrades harmlessly.
 *
 * - Ingestion: session-log content → an achieved/not-achieved verdict
 *   with the evaluator's stated reason. Defensive by contract: absence
 *   of a marker returns null, and nothing in here ever throws.
 */

/** Hard cap on the composed condition text (request 41.2 constraint). */
export const GOAL_CONDITION_MAX_CHARS = 4000;

/**
 * Default turn bound baked into every composed condition, so a session
 * that cannot reach the goal stops and reports instead of spinning.
 */
export const DEFAULT_GOAL_TURN_BOUND = 50;

/** Individual criteria are clamped so one novel can't eat the budget. */
const CRITERION_MAX_CHARS = 300;

/**
 * Pull acceptance criteria out of a request file's markdown.
 *
 * Looks for a heading containing "acceptance criteria" (any level —
 * covers both "## Acceptance Criteria" and the "## Acceptance Criteria
 * → Test Mapping" table form), then collects until the next heading:
 * - table rows: the first cell of each body row (header + separator
 *   rows are skipped);
 * - bullet items: `- ` / `* ` list entries.
 *
 * Returns [] when no criteria section exists — callers skip /goal.
 */
export function extractAcceptanceCriteria(requestContent: string): string[] {
  if (!requestContent) return [];
  const lines = requestContent.split("\n");

  const headingIdx = lines.findIndex((l) =>
    /^#{1,6}\s+.*acceptance criteria/i.test(l)
  );
  if (headingIdx === -1) return [];

  const criteria: string[] = [];
  let lastWasTableRow = false;

  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) break; // next section

    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      // Separator row (|---|---|): the row collected just before it was
      // the header — drop it.
      if (/^\|(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(trimmed)) {
        if (lastWasTableRow) criteria.pop();
        continue;
      }
      const firstCell = trimmed.split("|")[1]?.trim() ?? "";
      if (firstCell) {
        criteria.push(firstCell);
        lastWasTableRow = true;
      }
      continue;
    }
    lastWasTableRow = false;

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) criteria.push(bullet[1].trim());
  }

  return criteria.filter((c) => c.length > 0);
}

/** Collapse a criterion to a single clamped line for the condition. */
function cleanCriterion(criterion: string): string {
  const flat = criterion.replace(/\s+/g, " ").trim();
  return flat.length > CRITERION_MAX_CHARS
    ? `${flat.slice(0, CRITERION_MAX_CHARS - 1)}…`
    : flat;
}

export interface ComposeGoalOptions {
  /** Overrides DEFAULT_GOAL_TURN_BOUND. */
  turnBound?: number;
}

/**
 * Compose the /goal condition text from a criteria list. Returns null
 * when there are no criteria (ad-hoc dispatch → no /goal).
 *
 * Single line, ≤ GOAL_CONDITION_MAX_CHARS. When the criteria list
 * overflows the budget, trailing criteria are dropped and acknowledged
 * with a "(+N more — see the request file)" marker; the validate.sh
 * check and the turn bound always survive truncation.
 */
export function composeGoalCondition(
  criteria: string[],
  opts: ComposeGoalOptions = {}
): string | null {
  const cleaned = criteria.map(cleanCriterion).filter((c) => c.length > 0);
  if (cleaned.length === 0) return null;

  const turnBound = opts.turnBound ?? DEFAULT_GOAL_TURN_BOUND;
  const intro =
    "Work until all acceptance criteria for the current request are demonstrably met: ";
  const tail =
    " Also required: scripts/validate.sh exits 0, shown by running it in this session." +
    ` Or stop after ${turnBound} turns and report what is blocking.`;

  const build = (included: string[], dropped: number): string => {
    const suffix =
      dropped > 0 ? `; (+${dropped} more — see the request file)` : "";
    return `${intro}${included.join("; ")}${suffix}.${tail}`;
  };

  for (let k = cleaned.length; k >= 1; k--) {
    const condition = build(cleaned.slice(0, k), cleaned.length - k);
    if (condition.length <= GOAL_CONDITION_MAX_CHARS) return condition;
  }

  // Even one clamped criterion overflowed the budget alongside the
  // fixed sentences — cannot happen with the clamps above, but keep a
  // hard guarantee rather than an assumption.
  return build([cleaned[0]], cleaned.length - 1).slice(
    0,
    GOAL_CONDITION_MAX_CHARS
  );
}

/**
 * Compose the full `/goal <condition>` line from request-file content.
 * Null when the request carries no acceptance criteria.
 */
export function composeGoalLine(
  requestContent: string,
  opts: ComposeGoalOptions = {}
): string | null {
  const condition = composeGoalCondition(
    extractAcceptanceCriteria(requestContent),
    opts
  );
  return condition ? `/goal ${condition}` : null;
}

/**
 * Recover the goal condition from a composed dispatch prompt (the
 * Dispatch row snapshots the prompt; ingestion reads it back). Returns
 * the text of the first `/goal ` line, or null when none exists.
 */
export function extractGoalCondition(
  promptText: string | null | undefined
): string | null {
  if (!promptText) return null;
  for (const line of promptText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/goal ")) {
      const condition = trimmed.slice("/goal ".length).trim();
      return condition.length > 0 ? condition : null;
    }
  }
  return null;
}

export interface GoalOutcome {
  achieved: boolean;
  /** The evaluator's stated reason, when the marker carried one. */
  reason: string | null;
}

// Verdict markers, negative and positive. Both bracket-tag form
// ([GOAL ACHIEVED] — the fleet's signal convention, cf. [NEEDS
// ATTENTION]) and prose form ("Goal achieved: …") are accepted. The
// prose positives require "goal" immediately before the verb so "goal
// not achieved" can never match them.
// The prose patterns carry a (?<!\[) lookbehind so they never re-match
// the text inside a bracket tag (which would capture the closing "]"
// into the reason).
const NOT_ACHIEVED_PATTERNS = [
  /\[GOAL NOT ACHIEVED\]\s*[:—–-]?\s*(.*)/gi,
  /(?<!\[)\bgoal (?:was )?not (?:achieved|met|reached)\b\s*[:—–-]?\s*(.*)/gi,
];
const ACHIEVED_PATTERNS = [
  /\[GOAL ACHIEVED\]\s*[:—–-]?\s*(.*)/gi,
  /(?<!\[)\bgoal (?:was )?(?:achieved|met|reached)\b\s*[:—–-]?\s*(.*)/gi,
];

/**
 * Parse a goal-evaluator verdict out of a session log.
 *
 * Defensive by contract (request 41.2): null/empty/marker-less content
 * returns null — goalAchieved stays unknown — and this function never
 * throws. When multiple verdicts appear, the LAST one in the log wins
 * (a session can miss the goal, recover, and finish achieved).
 */
export function parseGoalOutcome(
  logContent: string | null | undefined
): GoalOutcome | null {
  if (typeof logContent !== "string" || logContent.length === 0) return null;

  try {
    let best: { index: number; outcome: GoalOutcome } | null = null;

    const scan = (patterns: RegExp[], achieved: boolean): void => {
      for (const pattern of patterns) {
        // Fresh regex per call — the module-level ones carry /g state.
        const re = new RegExp(pattern.source, pattern.flags);
        for (const match of logContent.matchAll(re)) {
          const index = match.index ?? 0;
          if (best && index < best.index) continue;
          // A negative match ("goal not achieved") contains text the
          // positive prose pattern can never reach (see pattern note),
          // so same-index collisions don't occur across polarities.
          const rawReason = (match[1] ?? "").trim();
          best = {
            index,
            outcome: { achieved, reason: rawReason.length > 0 ? rawReason : null },
          };
        }
      }
    };

    scan(NOT_ACHIEVED_PATTERNS, false);
    scan(ACHIEVED_PATTERNS, true);

    return best ? (best as { index: number; outcome: GoalOutcome }).outcome : null;
  } catch {
    // Never let goal parsing take down ingestion.
    return null;
  }
}
