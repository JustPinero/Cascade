export interface EscalationSignal {
  type: "needs-attention" | "lesson" | "test-failure" | "phase-complete" | "human-todo";
  message: string;
}

/**
 * Parse a session log for escalation signals.
 *
 * Detects:
 * - [NEEDS ATTENTION] — Claude is stuck and needs human input
 * - [LESSON] — a reusable insight worth harvesting
 * - Test failures — mentions of failing tests
 * - Phase completion — mentions of completing a phase
 */
export function detectEscalations(content: string): EscalationSignal[] {
  if (!content) return [];

  const signals: EscalationSignal[] = [];

  // [NEEDS ATTENTION] — may appear multiple times
  const attentionMatches = content.matchAll(/\[NEEDS ATTENTION\]\s*(.*)/g);
  for (const match of attentionMatches) {
    signals.push({
      type: "needs-attention",
      message: match[1].trim(),
    });
  }

  // [HUMAN TODO] — tasks that require human action
  const todoMatches = content.matchAll(/\[HUMAN TODO\]\s*(.*)/g);
  for (const match of todoMatches) {
    signals.push({
      type: "human-todo",
      message: match[1].trim(),
    });
  }

  // [LESSON] — may appear multiple times
  const lessonMatches = content.matchAll(/\[LESSON\]\s*(.*)/g);
  for (const match of lessonMatches) {
    signals.push({
      type: "lesson",
      message: match[1].trim(),
    });
  }

  // Test failures — tightened in Phase 23 follow-up P1.2.
  // - Pattern 1: digit + test/spec word + failed — "5 tests failed".
  // - Pattern 2: failed/failing + test/spec context — "failing tests",
  //   "failed in the build". "failed to" no longer triggers (the
  //   alternative is "in <test|spec|build|ci>", not bare "in").
  // - Pattern 3: word-bounded "test fail" — "8 tests fail in suite".
  //   The trailing \b rejects "test failed to compile" (fail is a
  //   substring of failed, no boundary).
  // - Pattern 4: runner-summary form "Tests: 5 failed" / "Tests 5
  //   failed". Test runners (jest, pytest, vitest) emit this shape.
  //
  // What's deliberately excluded by these tightenings: "5 failed
  // deployments", "8 failed health checks", "test failed to compile".
  const testFailurePatterns = [
    /(\d+)\s+(?:tests?|specs?)\s+fail(?:ed|ing)/i,
    /fail(?:ed|ing)\s+(?:tests?|specs?|in\s+(?:the\s+)?(?:test|spec|build|ci))/i,
    /\btests?\s+fail\b/i,
    /\btests?\s*[:.]?\s*\d+\s+fail(?:ed|ing)/i,
  ];
  for (const pattern of testFailurePatterns) {
    const match = content.match(pattern);
    if (match) {
      signals.push({
        type: "test-failure",
        message: match[0],
      });
      break; // Only report once
    }
  }

  // Phase completion — tightened in P1.2.
  // \b after the digit prevents `\d+` from backtracking to a shorter
  // match. (?!-) then rejects identifiers like "phase 12-alpha" or
  // "phase 12-rc1" where the number is part of a longer token.
  // Without \b, the engine would try `\d+`="12" → fail (next is "-"),
  // then backtrack to "1" → succeed (next is "2", not "-"). The \b
  // forces the digit run to be a complete number first.
  const phaseCompletePatterns = [
    /phase\s+\d+\b(?!-)\s+complete/i,
    /completed?\s+phase\s+\d+\b(?!-)/i,
    /all\s+requests?\s+(?:done|complete)/i,
  ];
  for (const pattern of phaseCompletePatterns) {
    const match = content.match(pattern);
    if (match) {
      signals.push({
        type: "phase-complete",
        message: match[0],
      });
      break;
    }
  }

  return signals;
}
