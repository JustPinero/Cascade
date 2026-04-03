export interface EscalationSignal {
  type: "needs-attention" | "lesson" | "test-failure" | "phase-complete";
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

  // [LESSON] — may appear multiple times
  const lessonMatches = content.matchAll(/\[LESSON\]\s*(.*)/g);
  for (const match of lessonMatches) {
    signals.push({
      type: "lesson",
      message: match[1].trim(),
    });
  }

  // Test failures — various patterns
  const testFailurePatterns = [
    /(\d+)\s+(?:tests?\s+)?fail(?:ed|ing)/i,
    /fail(?:ed|ing)\s+(?:tests?|in)/i,
    /tests?\s+fail/i,
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

  // Phase completion
  const phaseCompletePatterns = [
    /phase\s+\d+\s+complete/i,
    /completed?\s+phase\s+\d+/i,
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
