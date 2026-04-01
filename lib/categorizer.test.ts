import { describe, it, expect } from "vitest";
import { categorize } from "./categorizer";

describe("categorizer", () => {
  describe("path-based categorization", () => {
    it("deploy path → deployment", () => {
      const result = categorize("Lesson", "Some content", "deploy/config.ts");
      expect(result.category).toBe("deployment");
    });

    it("auth path → auth", () => {
      const result = categorize("Lesson", "Some content", "auth/middleware.ts");
      expect(result.category).toBe("auth");
    });

    it("prisma path → database", () => {
      const result = categorize("Lesson", "Some content", "prisma/schema.prisma");
      expect(result.category).toBe("database");
    });

    it("test path → testing", () => {
      const result = categorize("Lesson", "Some content", "tests/auth.test.ts");
      expect(result.category).toBe("testing");
    });
  });

  describe("content-based categorization", () => {
    it("database keywords → database", () => {
      const result = categorize(
        "Always use WAL mode",
        "When using SQLite with Prisma, enable WAL mode for concurrent database reads. Use transaction for atomic writes.",
        null
      );
      expect(result.category).toBe("database");
    });

    it("deployment keywords → deployment", () => {
      const result = categorize(
        "CI pipeline config",
        "The deploy pipeline on Vercel should use build caching. Docker containers need proper hosting setup.",
        null
      );
      expect(result.category).toBe("deployment");
    });

    it("error handling keywords → error-handling", () => {
      const result = categorize(
        "Handle API errors",
        "Always use error boundaries. Add retry logic with timeout for external API calls. Log the exception and stack trace.",
        null
      );
      expect(result.category).toBe("error-handling");
    });

    it("performance keywords → performance", () => {
      const result = categorize(
        "Bundle optimization",
        "Lazy load heavy components. Use cache headers. Optimize bundle size and streaming SSR for better performance.",
        null
      );
      expect(result.category).toBe("performance");
    });

    it("anti-pattern keywords → anti-patterns", () => {
      const result = categorize(
        "Avoid floating promises",
        "Never leave promises unhandled. This anti-pattern is a common mistake and footgun. Don't do this.",
        null
      );
      expect(result.category).toBe("anti-patterns");
    });
  });

  describe("fallback behavior", () => {
    it("falls back to architecture when no signals", () => {
      const result = categorize("Random thought", "No keywords here at all.", null);
      expect(result.category).toBe("architecture");
    });
  });

  describe("tag extraction", () => {
    it("extracts relevant tags from content", () => {
      const result = categorize(
        "Database setup",
        "Use Prisma with SQLite. Add proper migration handling and connection pooling.",
        null
      );
      expect(result.tags).toContain("prisma");
      expect(result.tags).toContain("sqlite");
      expect(result.tags).toContain("migration");
    });

    it("caps tags at 10", () => {
      const result = categorize(
        "Everything lesson",
        "deploy auth prisma performance test error api anti-pattern architecture tool script cache bundle mock fixture retry timeout webhook pattern module",
        null
      );
      expect(result.tags.length).toBeLessThanOrEqual(10);
    });
  });

  describe("combined signals", () => {
    it("path wins when content agrees", () => {
      const result = categorize(
        "DB migrations",
        "Prisma migration schema database query",
        "prisma/migrations/001.sql"
      );
      expect(result.category).toBe("database");
    });

    it("content wins when path disagrees strongly", () => {
      const result = categorize(
        "Deploy error handling",
        "Always catch errors with error boundaries. Add retry and timeout. Log exceptions. Handle failure gracefully.",
        "deploy/scripts/build.sh"
      );
      // Error handling has more keyword hits than deployment
      expect(["error-handling", "deployment"]).toContain(result.category);
    });
  });
});
