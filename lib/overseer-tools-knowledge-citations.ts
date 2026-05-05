/**
 * Phase 25.3 — query_knowledge_with_citations tool.
 *
 * Runs the existing knowledge-matcher and returns the top-N lessons
 * formatted with [L-{id}] markers in the content. The Overseer's
 * system prompt instructs the model to cite using those markers
 * when its answer leans on a lesson; the chat client renders the
 * markers as clickable links to /knowledge/lesson/<id>.
 *
 * Pragmatic vs. Anthropic Citations API: this is the prompt-engineered
 * variant. cited_text drift is possible (model paraphrases). Trade-off
 * is implementation simplicity — no document-block injection, no
 * block-index → lesson-id mapping in the route, no streaming citations
 * decoder. Migration to the real Citations API is unblocked but not
 * required for the UX to land.
 */
import type { Tool, ToolContext } from "@/lib/overseer-tools";
import {
  matchIssueToLessons,
  type MatchableLesson,
} from "@/lib/knowledge-matcher";

interface QueryKnowledgeInput {
  query: string;
  topN?: number;
}

interface CitationLessonShape {
  id: number;
  title: string;
  category: string;
  severity: string;
  matchedKeywords: string[];
}

interface QueryKnowledgeOutput {
  query: string;
  topN: number;
  totalMatches: number;
  lessons: CitationLessonShape[];
  /**
   * Pre-formatted briefing the model should fold into its answer.
   * Each lesson is prefixed with `[L-{id}]` so the model can quote
   * the marker verbatim when it cites the source.
   */
  briefing: string;
}

const DEFAULT_TOP_N = 5;
const MAX_TOP_N = 10;
const MAX_CONTENT_PER_LESSON = 1200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export const knowledgeCitationsTool: Tool<
  QueryKnowledgeInput,
  QueryKnowledgeOutput
> = {
  name: "query_knowledge_with_citations",
  description:
    "Search the knowledge base for lessons relevant to a query. Returns top-N matched lessons with citation markers ([L-<id>]). When you use a lesson's content in your answer, cite it by writing the exact marker — e.g. \"...switch to WAL journaling [L-42].\" The chat UI renders these markers as clickable links to the lesson detail page. Use this when the developer asks a how-to / what-to-do question that the knowledge base might already answer.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Issue or question to match against the knowledge base.",
      },
      topN: {
        type: "number",
        description: `Max lessons to return. Default ${DEFAULT_TOP_N}, capped at ${MAX_TOP_N}.`,
      },
    },
    required: ["query"],
  },
  handler: async (
    input: QueryKnowledgeInput,
    ctx: ToolContext
  ): Promise<QueryKnowledgeOutput> => {
    const topN = Math.min(input.topN ?? DEFAULT_TOP_N, MAX_TOP_N);

    const allLessons = await ctx.prisma.knowledgeLesson.findMany();
    const matchable: MatchableLesson[] = allLessons.map((l) => ({
      id: l.id,
      title: l.title,
      content: l.content,
      tags: l.tags,
      category: l.category,
      severity: l.severity,
    }));

    const results = matchIssueToLessons(input.query, matchable).slice(0, topN);
    const lessonsById = new Map(allLessons.map((l) => [l.id, l]));

    const lessons: CitationLessonShape[] = results.map((r) => ({
      id: r.lessonId,
      title: r.lessonTitle,
      category: r.category,
      severity: r.severity,
      matchedKeywords: r.matchedKeywords,
    }));

    const briefing = results.length
      ? results
          .map((r) => {
            const full = lessonsById.get(r.lessonId);
            const content = full
              ? truncate(full.content, MAX_CONTENT_PER_LESSON)
              : "";
            return `[L-${r.lessonId}] ${r.lessonTitle}\n${content}`;
          })
          .join("\n\n---\n\n")
      : "(no matching lessons in the knowledge base)";

    return {
      query: input.query,
      topN,
      totalMatches: results.length,
      lessons,
      briefing,
    };
  },
};
