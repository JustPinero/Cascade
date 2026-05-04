/**
 * Phase 23.7 — knowledge-matcher kind executor.
 *
 * Pure: no DB, no API. Calls `matchIssueToLessons` against the
 * inline lesson corpus from the scenario fixture and runs the
 * top-N asserter.
 */
import type { KindExecutor } from "../runner";
import type { KnowledgeMatchInput, KnowledgeMatchExpectation } from "../types";
import { matchIssueToLessons, type MatchableLesson } from "@/lib/knowledge-matcher";
import { assertKnowledgeMatchTopN } from "../asserters";

export const knowledgeMatcherExecutor: KindExecutor = async (scenario) => {
  const input = scenario.input as KnowledgeMatchInput;
  const expected = scenario.assert as KnowledgeMatchExpectation;

  const lessons: MatchableLesson[] = input.lessons.map((l) => ({
    id: l.id,
    title: l.title,
    content: l.content,
    // tags in the matcher's MatchableLesson is a string (joined). The
    // fixture's tags are an array — join with commas to match the
    // production shape (Cascade stores tags as JSON-stringified arrays
    // in the DB and joins them when materializing into MatchableLesson).
    tags: l.tags.join(","),
    category: l.category,
    severity: l.severity,
  }));

  const results = matchIssueToLessons(input.query, lessons);
  return assertKnowledgeMatchTopN(
    { ids: results.map((r) => r.lessonId) },
    expected
  );
};
