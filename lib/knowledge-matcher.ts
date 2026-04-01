export interface MatchableLesson {
  id: number;
  title: string;
  content: string;
  tags: string;
  category: string;
  severity: string;
}

export interface MatchResult {
  lessonId: number;
  lessonTitle: string;
  score: number;
  matchedKeywords: string[];
  category: string;
  severity: string;
}

/**
 * Extract keywords from an issue/problem description.
 * Filters out common stop words and short terms.
 */
export function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "this", "that", "these",
    "those", "it", "its", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "as", "into", "about", "not", "no", "but", "or", "and",
    "if", "when", "then", "than", "so", "all", "each", "every", "any",
    "some", "such", "only", "own", "same", "too", "very",
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i); // dedupe
}

/**
 * Score a lesson against a set of issue keywords.
 * Returns 0 if below threshold.
 */
function scoreLessonMatch(
  lesson: MatchableLesson,
  keywords: string[]
): { score: number; matchedKeywords: string[] } {
  const lessonText = `${lesson.title} ${lesson.content} ${lesson.tags}`.toLowerCase();
  const matchedKeywords: string[] = [];
  let score = 0;

  for (const keyword of keywords) {
    if (lessonText.includes(keyword)) {
      matchedKeywords.push(keyword);

      // Title match is strongest
      if (lesson.title.toLowerCase().includes(keyword)) {
        score += 3;
      }
      // Content match
      else if (lesson.content.toLowerCase().includes(keyword)) {
        score += 1;
      }
      // Tag match
      else {
        score += 2;
      }
    }
  }

  // Severity bonus
  if (score > 0) {
    if (lesson.severity === "critical") score *= 1.5;
    else if (lesson.severity === "important") score *= 1.2;
  }

  return { score, matchedKeywords };
}

/**
 * Match an issue description against a set of knowledge lessons.
 * Returns lessons sorted by relevance score, filtered by threshold.
 */
export function matchIssueToLessons(
  issueText: string,
  lessons: MatchableLesson[],
  threshold: number = 2
): MatchResult[] {
  const keywords = extractKeywords(issueText);

  if (keywords.length === 0) return [];

  const results: MatchResult[] = [];

  for (const lesson of lessons) {
    const { score, matchedKeywords } = scoreLessonMatch(lesson, keywords);
    if (score >= threshold) {
      results.push({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        score,
        matchedKeywords,
        category: lesson.category,
        severity: lesson.severity,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
