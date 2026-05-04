/**
 * Phase 23.6 — eval asserters.
 *
 * Pure functions that return `{ pass, diff }` instead of throwing. The
 * runner decides what to do with a failure (CLI prints the diff,
 * programmatic callers can branch). Decoupling fail behavior from the
 * assertion logic keeps asserters reusable.
 */
import type {
  AnthropicMessage,
  ContentBlock,
} from "@/lib/overseer-tools";
import type {
  AssertResult,
  EscalationSignalsExpectation,
  KnowledgeMatchExpectation,
  OverseerToolSequenceExpectation,
} from "./types";

interface ToolCallObservation {
  name: string;
  input: Record<string, unknown>;
}

/**
 * Walk the loop's persisted message log and pull every tool_use block
 * the model emitted, in arrival order.
 */
export function extractToolCalls(
  messages: AnthropicMessage[]
): ToolCallObservation[] {
  const calls: ToolCallObservation[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    if (typeof m.content === "string") continue;
    for (const block of m.content) {
      if ((block as ContentBlock).type === "tool_use") {
        const tu = block as Extract<ContentBlock, { type: "tool_use" }>;
        calls.push({ name: tu.name, input: tu.input });
      }
    }
  }
  return calls;
}

function inputContainsMatches(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  for (const [k, v] of Object.entries(expected)) {
    if (!(k in actual)) return false;
    if (typeof v === "object" && v !== null) {
      if (
        !inputContainsMatches(
          v as Record<string, unknown>,
          (actual[k] as Record<string, unknown>) ?? {}
        )
      ) {
        return false;
      }
    } else if (actual[k] !== v) {
      return false;
    }
  }
  return true;
}

export interface OverseerToolSequenceObservation {
  toolCalls: ToolCallObservation[];
  finalText: string;
}

/**
 * Asserts the expected tool sequence appears as an in-order subsequence
 * (with optional `inputContains` partial match) within the observed
 * tool calls. The model is allowed to make additional calls between
 * expected ones — the asserter is permissive about extras unless
 * minToolCalls/maxToolCalls is set.
 */
export function assertToolSequence(
  observed: OverseerToolSequenceObservation,
  expected: OverseerToolSequenceExpectation
): AssertResult {
  if (expected.toolSequence) {
    let cursor = 0;
    for (const exp of expected.toolSequence) {
      const idx = observed.toolCalls.findIndex(
        (tc, i) =>
          i >= cursor &&
          tc.name === exp.name &&
          (exp.inputContains
            ? inputContainsMatches(exp.inputContains, tc.input)
            : true)
      );
      if (idx === -1) {
        return {
          pass: false,
          diff: [
            `expected tool sequence not satisfied at index ${cursor}`,
            `  expected: ${exp.name}${
              exp.inputContains
                ? ` matching ${JSON.stringify(exp.inputContains)}`
                : ""
            }`,
            `  observed (from cursor ${cursor}): ${observed.toolCalls
              .slice(cursor)
              .map((tc) => tc.name)
              .join(" → ") || "(none)"}`,
            ``,
            `full observed sequence: ${observed.toolCalls
              .map((tc) => tc.name)
              .join(" → ")}`,
          ].join("\n"),
        };
      }
      cursor = idx + 1;
    }
  }
  if (expected.minToolCalls !== undefined) {
    if (observed.toolCalls.length < expected.minToolCalls) {
      return {
        pass: false,
        diff: `expected at least ${expected.minToolCalls} tool calls; observed ${observed.toolCalls.length}`,
      };
    }
  }
  if (expected.maxToolCalls !== undefined) {
    if (observed.toolCalls.length > expected.maxToolCalls) {
      return {
        pass: false,
        diff: `expected at most ${expected.maxToolCalls} tool calls; observed ${observed.toolCalls.length}`,
      };
    }
  }
  if (expected.finalTextMatches) {
    const re = parseRegex(expected.finalTextMatches);
    if (!re.test(observed.finalText)) {
      return {
        pass: false,
        diff: `final text does not match ${expected.finalTextMatches}\n  text: ${observed.finalText.slice(0, 200)}`,
      };
    }
  }
  return { pass: true };
}

function parseRegex(s: string): RegExp {
  // Accepts "/pattern/flags" or plain "pattern" (no flags).
  const m = /^\/(.+)\/([a-z]*)$/.exec(s);
  if (m) return new RegExp(m[1], m[2]);
  return new RegExp(s);
}

export interface KnowledgeMatchObservation {
  /** Lesson IDs returned by the matcher, in score order. */
  ids: number[];
}

export function assertKnowledgeMatchTopN(
  observed: KnowledgeMatchObservation,
  expected: KnowledgeMatchExpectation
): AssertResult {
  const observedTopN = observed.ids.slice(0, expected.topN);
  const expectedTopN = expected.ids.slice(0, expected.topN);
  if (
    observedTopN.length !== expectedTopN.length ||
    observedTopN.some((id, i) => id !== expectedTopN[i])
  ) {
    return {
      pass: false,
      diff: [
        `top-${expected.topN} lesson IDs do not match`,
        `  expected: [${expectedTopN.join(", ")}]`,
        `  observed: [${observedTopN.join(", ")}]`,
      ].join("\n"),
    };
  }
  return { pass: true };
}

export interface EscalationObservation {
  signals: Array<{ type: string }>;
}

export function assertEscalationSignals(
  observed: EscalationObservation,
  expected: EscalationSignalsExpectation
): AssertResult {
  const observedTypes = observed.signals.map((s) => s.type).sort();
  const expectedTypes = [...expected.signals].sort();

  // Order-insensitive comparison.
  if (
    observedTypes.length !== expectedTypes.length ||
    observedTypes.some((t, i) => t !== expectedTypes[i])
  ) {
    return {
      pass: false,
      diff: [
        `escalation signal types do not match`,
        `  expected: [${expectedTypes.join(", ")}]`,
        `  observed: [${observedTypes.join(", ")}]`,
      ].join("\n"),
    };
  }
  return { pass: true };
}
