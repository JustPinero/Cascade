import { describe, it, expect } from "vitest";
import {
  extractKeywords,
  matchIssueToLessons,
  type MatchableLesson,
} from "./knowledge-matcher";

const testLessons: MatchableLesson[] = [
  {
    id: 1,
    title: "Always use WAL mode with SQLite",
    content: "Enable WAL journal mode for concurrent database reads with Prisma",
    tags: '["sqlite","prisma","performance"]',
    category: "database",
    severity: "critical",
  },
  {
    id: 2,
    title: "Use error boundaries in Next.js",
    content: "Add error.tsx files for each route segment to handle errors gracefully",
    tags: '["nextjs","error-handling"]',
    category: "error-handling",
    severity: "important",
  },
  {
    id: 3,
    title: "Lazy load images with next/image",
    content: "Use the next/image component for automatic image optimization",
    tags: '["nextjs","performance","images"]',
    category: "performance",
    severity: "nice-to-know",
  },
];

describe("extractKeywords", () => {
  it("extracts meaningful words", () => {
    const kw = extractKeywords("The database connection pool is failing");
    expect(kw).toContain("database");
    expect(kw).toContain("connection");
    expect(kw).toContain("pool");
    expect(kw).toContain("failing");
    expect(kw).not.toContain("the");
    expect(kw).not.toContain("is");
  });

  it("deduplicates keywords", () => {
    const kw = extractKeywords("error error error handling");
    const errorCount = kw.filter((w) => w === "error").length;
    expect(errorCount).toBe(1);
  });

  it("filters short words", () => {
    const kw = extractKeywords("a an is db ok");
    expect(kw).not.toContain("an");
    expect(kw).not.toContain("is");
  });
});

describe("matchIssueToLessons", () => {
  it("matches exact keyword hits", () => {
    const results = matchIssueToLessons(
      "SQLite database performance is slow with Prisma",
      testLessons
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].lessonTitle).toContain("WAL mode");
  });

  it("scores critical lessons higher", () => {
    const results = matchIssueToLessons(
      "database performance issues with concurrent reads",
      testLessons
    );
    // WAL mode lesson (critical) should score higher than lazy load (nice-to-know)
    const walMatch = results.find((r) => r.lessonId === 1);
    const lazyMatch = results.find((r) => r.lessonId === 3);
    if (walMatch && lazyMatch) {
      expect(walMatch.score).toBeGreaterThan(lazyMatch.score);
    }
  });

  it("returns empty array for no matches", () => {
    const results = matchIssueToLessons(
      "completely unrelated topic about cooking recipes",
      testLessons
    );
    expect(results).toEqual([]);
  });

  it("respects threshold", () => {
    const lowThreshold = matchIssueToLessons(
      "error handling",
      testLessons,
      1
    );
    const highThreshold = matchIssueToLessons(
      "error handling",
      testLessons,
      10
    );
    expect(lowThreshold.length).toBeGreaterThanOrEqual(
      highThreshold.length
    );
  });

  it("returns matched keywords", () => {
    const results = matchIssueToLessons(
      "SQLite database Prisma queries are slow",
      testLessons
    );
    const walMatch = results.find((r) => r.lessonId === 1);
    expect(walMatch).toBeDefined();
    expect(walMatch!.matchedKeywords.length).toBeGreaterThan(0);
  });
});
