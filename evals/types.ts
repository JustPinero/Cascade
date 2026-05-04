/**
 * Phase 23.6 — Eval runner shared types.
 *
 * Fixture shapes are validated against these at load time so a
 * malformed scenario file fails fast with a clear error.
 */

export type ScenarioKind =
  | "overseer-tool-sequence"
  | "knowledge-match-top-n"
  | "escalation-signals";

export interface OverseerToolSequenceExpectation {
  /** Ordered list of tool calls the model is expected to make. */
  toolSequence?: Array<{
    name: string;
    /** Partial-match: actual.input must contain every key in inputContains. */
    inputContains?: Record<string, unknown>;
  }>;
  /** Regex (string form, e.g. "/foo/i") the final assistant text must match. */
  finalTextMatches?: string;
  minToolCalls?: number;
  maxToolCalls?: number;
}

export interface KnowledgeMatchExpectation {
  /** Lesson IDs in expected score order, top-N to compare. */
  ids: number[];
  topN: number;
}

export interface EscalationSignalsExpectation {
  /** Set of signal types expected to be detected (order-insensitive). */
  signals: string[];
}

export interface OverseerScenarioInput {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  preconditions?: {
    projects?: Array<{
      slug: string;
      name?: string;
      path?: string;
      phase?: string;
      health?: string;
      status?: string;
      progressScore?: number;
    }>;
    activityEvents?: Array<{
      projectSlug: string;
      eventType: string;
      summary: string;
      details?: string;
    }>;
    dispatchOutcomes?: Array<{
      projectSlug: string;
      mode: string;
      outcome: string;
      signals?: string[];
      dispatchedAt?: string;
    }>;
    knowledgeLessons?: Array<{
      title: string;
      content: string;
      category: string;
      severity?: string;
      tags?: string[];
    }>;
  };
}

export interface KnowledgeMatchInput {
  query: string;
  /** Inline lesson corpus — fixture self-contained, not pinned to live DB. */
  lessons: Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    severity: string;
    tags: string[];
  }>;
}

export interface EscalationInput {
  /** Path relative to the scenario file's directory. */
  logFile: string;
}

export type ScenarioInput =
  | OverseerScenarioInput
  | KnowledgeMatchInput
  | EscalationInput;

export type ScenarioExpectation =
  | OverseerToolSequenceExpectation
  | KnowledgeMatchExpectation
  | EscalationSignalsExpectation;

export interface Scenario {
  name: string;
  kind: ScenarioKind;
  input: ScenarioInput;
  assert: ScenarioExpectation;
}

export interface AssertResult {
  pass: boolean;
  diff?: string;
}

export interface RunResult {
  scenarioName: string;
  kind: ScenarioKind;
  pass: boolean;
  diff?: string;
  /** Wall-clock time the scenario took (excludes recording write time). */
  durationMs: number;
}

export type RecorderMode = "replay" | "record";
