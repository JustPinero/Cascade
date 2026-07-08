/**
 * Phase 41.2 — goal-driven dispatch outcomes.
 *
 * Contract tests for the goal module: composing a /goal completion
 * condition from a request file's acceptance criteria, and defensively
 * parsing goal-evaluator verdicts back out of session logs.
 *
 * AC1: dispatcher composes a /goal line from acceptance criteria
 *      (naming transcript-visible checks: tests + validate.sh).
 * AC2: the condition includes a turn bound ("or stop after N turns").
 * AC5: ingestion parses goal achievement from a session log —
 *      fixture-driven, never throws on absence.
 * Constraint: conditions ≤ 4,000 chars; text degrades to meaningful
 * plain instructions on CLIs without /goal support.
 */
import { describe, it, expect } from "vitest";
import {
  extractAcceptanceCriteria,
  composeGoalCondition,
  composeGoalLine,
  extractGoalCondition,
  parseGoalOutcome,
  GOAL_CONDITION_MAX_CHARS,
  DEFAULT_GOAL_TURN_BOUND,
} from "./dispatch-goals";

const TABLE_REQUEST = `# Request 9.1 — Search

## Objective
Build search.

## Acceptance Criteria → Test Mapping

| Criterion | Test |
|-----------|------|
| Search returns matching projects by slug | unit: query "med" returns medipal |
| Empty query returns 400 | unit: GET /api/search?q= → 400 |

## Constraints
- None.
`;

const BULLET_REQUEST = `# Request 3.2

## Acceptance Criteria
- Health score recomputes on webhook ping
- Stale projects flagged after 7 days

## Notes
Other stuff.
`;

describe("extractAcceptanceCriteria", () => {
  it("extracts first-column criteria from a criteria table, skipping the header row", () => {
    const criteria = extractAcceptanceCriteria(TABLE_REQUEST);
    expect(criteria).toEqual([
      "Search returns matching projects by slug",
      "Empty query returns 400",
    ]);
  });

  it("extracts bullet-list criteria", () => {
    const criteria = extractAcceptanceCriteria(BULLET_REQUEST);
    expect(criteria).toEqual([
      "Health score recomputes on webhook ping",
      "Stale projects flagged after 7 days",
    ]);
  });

  it("returns [] when the request has no acceptance-criteria section", () => {
    expect(extractAcceptanceCriteria("# Just a title\n\nSome prose.")).toEqual(
      []
    );
    expect(extractAcceptanceCriteria("")).toEqual([]);
  });
});

describe("composeGoalCondition (AC1 + AC2 + constraints)", () => {
  const criteria = [
    "Search returns matching projects by slug",
    "Empty query returns 400",
  ];

  it("names the acceptance criteria and the transcript-visible validate.sh check", () => {
    const condition = composeGoalCondition(criteria);
    expect(condition).not.toBeNull();
    expect(condition).toContain("Search returns matching projects by slug");
    expect(condition).toContain("Empty query returns 400");
    expect(condition).toContain("scripts/validate.sh exits 0");
    // Evaluator reads only the transcript — the check must be surfaced.
    expect(condition).toMatch(/shown by running it/i);
  });

  it("includes a turn bound (AC2)", () => {
    const condition = composeGoalCondition(criteria);
    expect(condition).toMatch(
      new RegExp(`stop after ${DEFAULT_GOAL_TURN_BOUND} turns`, "i")
    );
  });

  it("honors a custom turn bound", () => {
    const condition = composeGoalCondition(criteria, { turnBound: 12 });
    expect(condition).toMatch(/stop after 12 turns/i);
  });

  it("returns null for an empty criteria list", () => {
    expect(composeGoalCondition([])).toBeNull();
  });

  it("degrades to meaningful plain instructions (no /goal-only syntax)", () => {
    // On an older CLI the line is just a prompt sentence — the condition
    // must read as an instruction on its own.
    const condition = composeGoalCondition(criteria)!;
    expect(condition).toMatch(/^Work until/);
    expect(condition).not.toContain("\n");
  });

  it("caps the condition at 4,000 chars, truncating the criteria list sensibly", () => {
    const many = Array.from(
      { length: 200 },
      (_, i) => `Criterion number ${i} — ${"x".repeat(90)}`
    );
    const condition = composeGoalCondition(many)!;
    expect(condition.length).toBeLessThanOrEqual(GOAL_CONDITION_MAX_CHARS);
    // The tail sentences survive truncation — bound + validate.sh stay.
    expect(condition).toContain("scripts/validate.sh exits 0");
    expect(condition).toMatch(/stop after \d+ turns/i);
    // Dropped criteria are acknowledged, not silently lost.
    expect(condition).toMatch(/\+\d+ more/);
  });
});

describe("composeGoalLine", () => {
  it("returns a single /goal line composed from the request content", () => {
    const line = composeGoalLine(TABLE_REQUEST);
    expect(line).not.toBeNull();
    expect(line!.startsWith("/goal ")).toBe(true);
    expect(line).toContain("Search returns matching projects by slug");
    expect(line).not.toContain("\n");
  });

  it("returns null when the request has no acceptance criteria", () => {
    expect(composeGoalLine("# No criteria here")).toBeNull();
  });
});

describe("extractGoalCondition", () => {
  it("pulls the condition back out of a composed prompt", () => {
    const prompt = `/goal Work until X is done. Or stop after 50 turns.\nRead CLAUDE.md and continue.`;
    expect(extractGoalCondition(prompt)).toBe(
      "Work until X is done. Or stop after 50 turns."
    );
  });

  it("returns null when the prompt carries no /goal line", () => {
    expect(extractGoalCondition("Read CLAUDE.md and continue.")).toBeNull();
    expect(extractGoalCondition(null)).toBeNull();
    expect(extractGoalCondition(undefined)).toBeNull();
    expect(extractGoalCondition("")).toBeNull();
  });
});

describe("parseGoalOutcome (AC5 — defensive, fixture-driven)", () => {
  it("parses a bracket-tag achieved marker with reason", () => {
    const log = [
      "# Session log",
      "Ran the suite.",
      "[GOAL ACHIEVED] all acceptance criteria verified; validate.sh exited 0",
    ].join("\n");
    expect(parseGoalOutcome(log)).toEqual({
      achieved: true,
      reason: "all acceptance criteria verified; validate.sh exited 0",
    });
  });

  it("parses a prose achieved marker", () => {
    const result = parseGoalOutcome("Goal achieved: everything passing.");
    expect(result).not.toBeNull();
    expect(result!.achieved).toBe(true);
    expect(result!.reason).toContain("everything passing");
  });

  it("parses a not-achieved marker with reason", () => {
    const result = parseGoalOutcome(
      "[GOAL NOT ACHIEVED] blocked on schema migration"
    );
    expect(result).toEqual({
      achieved: false,
      reason: "blocked on schema migration",
    });
  });

  it("parses a prose not-achieved marker", () => {
    const result = parseGoalOutcome("Goal not achieved: ran out of turns");
    expect(result).not.toBeNull();
    expect(result!.achieved).toBe(false);
  });

  it("returns a null reason when the marker has no trailing text", () => {
    const result = parseGoalOutcome("did things\n[GOAL ACHIEVED]\n");
    expect(result).toEqual({ achieved: true, reason: null });
  });

  it("the last verdict in the log wins", () => {
    const log = [
      "Goal not achieved: tests failing",
      "…fixed the tests…",
      "[GOAL ACHIEVED] suite green on retry",
    ].join("\n");
    expect(parseGoalOutcome(log)?.achieved).toBe(true);
  });

  it("returns null (never throws) when no marker is present", () => {
    expect(parseGoalOutcome("A perfectly normal session log.")).toBeNull();
    expect(parseGoalOutcome("")).toBeNull();
    expect(parseGoalOutcome(null)).toBeNull();
    expect(parseGoalOutcome(undefined)).toBeNull();
  });

  it("does not misread 'goal not achieved' as achieved", () => {
    expect(parseGoalOutcome("The goal not achieved this time.")?.achieved).toBe(
      false
    );
  });
});
