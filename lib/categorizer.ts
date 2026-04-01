export type LessonCategory =
  | "deployment"
  | "auth"
  | "database"
  | "performance"
  | "testing"
  | "error-handling"
  | "integrations"
  | "anti-patterns"
  | "architecture"
  | "tooling";

interface CategorizationResult {
  category: LessonCategory;
  tags: string[];
}

const pathPatterns: [RegExp, LessonCategory][] = [
  [/deploy|vercel|railway|ci|pipeline|hosting|docker/i, "deployment"],
  [/test|vitest|playwright|coverage|mock|fixture|e2e|spec/i, "testing"],
  [/auth|login|session|token|password|oauth|jwt|middleware/i, "auth"],
  [/prisma|sqlite|database|db|migration|schema|query|sql/i, "database"],
  [/perf|speed|optim|cache|bundle|lazy|prefetch|memory/i, "performance"],
  [/error|exception|catch|boundary|fallback|retry|timeout|log/i, "error-handling"],
  [/api|webhook|sdk|third-party|external|integration|cli/i, "integrations"],
  [/anti-pattern|avoid|wrong|mistake|bad practice|footgun|pitfall/i, "anti-patterns"],
  [/tool|script|automat|lint|format|build tool|dev tool/i, "tooling"],
];

const contentKeywords: Record<LessonCategory, string[]> = {
  deployment: [
    "deploy", "vercel", "railway", "ci", "pipeline", "build", "hosting",
    "domain", "ssl", "docker", "container", "cdn",
  ],
  auth: [
    "auth", "login", "session", "token", "password", "oauth", "jwt",
    "middleware", "permission", "role", "credential", "cookie",
  ],
  database: [
    "prisma", "sqlite", "database", "query", "migration", "schema",
    "connection", "pool", "transaction", "index", "relation", "orm",
  ],
  performance: [
    "performance", "speed", "optimization", "cache", "bundle", "lazy",
    "prefetch", "memory", "render", "hydration", "streaming", "ssr",
  ],
  testing: [
    "test", "vitest", "playwright", "coverage", "mock", "fixture",
    "assertion", "e2e", "unit test", "integration test", "tdd",
  ],
  "error-handling": [
    "error", "exception", "catch", "boundary", "fallback", "retry",
    "timeout", "logging", "stack trace", "crash", "failure",
  ],
  integrations: [
    "api", "webhook", "sdk", "third-party", "external", "integration",
    "cli", "rest", "graphql", "endpoint", "fetch",
  ],
  "anti-patterns": [
    "anti-pattern", "avoid", "don't", "never", "mistake", "bad practice",
    "footgun", "pitfall", "wrong", "deprecated", "smell",
  ],
  architecture: [
    "architecture", "structure", "pattern", "design", "component",
    "module", "boundary", "separation", "layer", "monorepo",
  ],
  tooling: [
    "tool", "script", "automation", "cli", "build", "lint", "format",
    "prettier", "eslint", "webpack", "turbopack", "pnpm",
  ],
};

/**
 * Categorize a lesson based on its source file path.
 */
function categorizeByPath(
  filePath: string | null
): LessonCategory | null {
  if (!filePath) return null;
  for (const [pattern, category] of pathPatterns) {
    if (pattern.test(filePath)) return category;
  }
  return null;
}

/**
 * Score content against each category's keywords.
 * Returns sorted scores.
 */
function scoreContent(
  content: string
): { category: LessonCategory; score: number }[] {
  const lower = content.toLowerCase();
  const scores: { category: LessonCategory; score: number }[] = [];

  for (const [category, keywords] of Object.entries(contentKeywords)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) score++;
    }
    if (score > 0) {
      scores.push({ category: category as LessonCategory, score });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Extract tags from content based on keyword matches across all categories.
 */
function extractTags(content: string): string[] {
  const lower = content.toLowerCase();
  const tags: string[] = [];

  for (const keywords of Object.values(contentKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword) && !tags.includes(keyword)) {
        tags.push(keyword);
      }
    }
  }

  return tags.slice(0, 10); // Cap at 10 tags
}

/**
 * Categorize a lesson based on its title, content, and source file path.
 * Uses a multi-signal approach:
 * 1. File path heuristics (strongest signal)
 * 2. Content keyword scoring
 * 3. Falls back to "architecture" if ambiguous
 */
export function categorize(
  title: string,
  content: string,
  sourceFile: string | null = null
): CategorizationResult {
  // Signal 1: file path
  const pathCategory = categorizeByPath(sourceFile);

  // Signal 2: content scoring (title + content)
  const fullText = `${title} ${content}`;
  const scores = scoreContent(fullText);

  // Tags from all matches
  const tags = extractTags(fullText);

  // Decide category
  let category: LessonCategory;

  if (pathCategory && scores.length > 0) {
    // Path matches and content has signals — prefer path if content agrees
    const pathScore = scores.find((s) => s.category === pathCategory);
    if (pathScore && pathScore.score >= scores[0].score * 0.5) {
      category = pathCategory;
    } else {
      category = scores[0].category;
    }
  } else if (pathCategory) {
    category = pathCategory;
  } else if (scores.length > 0) {
    category = scores[0].category;
  } else {
    // Fallback
    category = "architecture";
  }

  return { category, tags };
}
