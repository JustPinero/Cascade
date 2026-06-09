/**
 * Phase 31 — closes audit finding [30.D6].
 *
 * `lesson.tags` is a Prisma JSON-as-String column. Two knowledge
 * pages were inlining `JSON.parse(lesson.tags)` into JSX with no
 * guard, so one malformed row would crash the page. This helper
 * centralizes the parse + array-coercion semantics so all three
 * lesson surfaces use the same tolerant code path.
 */

export function parseLessonTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map(String);
}
