import { describe, it, expect } from "vitest";
import { analyzeSessionPatterns } from "./playbook-learner";

describe("analyzeSessionPatterns", () => {
  it("detects recurring lessons across projects", () => {
    const sessions = [
      {
        projectName: "ratracer",
        content: "[LESSON] Always run prisma generate after schema changes.",
      },
      {
        projectName: "pointpartner",
        content: "[LESSON] Run prisma generate after updating the schema.",
      },
      {
        projectName: "medipal",
        content: "[LESSON] Prisma client must be regenerated after schema edits.",
      },
    ];

    const suggestions = analyzeSessionPatterns(sessions);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].type).toBe("recurring-lesson");
    expect(suggestions[0].occurrences).toBeGreaterThanOrEqual(3);
  });

  it("detects recurring blockers across projects", () => {
    const sessions = [
      {
        projectName: "ratracer",
        content: "[NEEDS ATTENTION] CORS issue with API routes.",
      },
      {
        projectName: "sitelift",
        content: "[NEEDS ATTENTION] CORS headers missing on API response.",
      },
      {
        projectName: "CON-CORE",
        content: "[NEEDS ATTENTION] CORS policy blocking fetch requests.",
      },
    ];

    const suggestions = analyzeSessionPatterns(sessions);
    const blockerSuggestion = suggestions.find(
      (s) => s.type === "recurring-blocker"
    );
    expect(blockerSuggestion).toBeDefined();
    expect(blockerSuggestion!.occurrences).toBeGreaterThanOrEqual(3);
  });

  it("returns empty for sessions with no patterns", () => {
    const sessions = [
      { projectName: "a", content: "Did some work on auth." },
      { projectName: "b", content: "Fixed a CSS layout issue." },
      { projectName: "c", content: "Added database migrations." },
    ];

    const suggestions = analyzeSessionPatterns(sessions);
    expect(suggestions).toEqual([]);
  });

  it("handles empty session list", () => {
    expect(analyzeSessionPatterns([])).toEqual([]);
  });

  it("includes affected projects in suggestion", () => {
    const sessions = [
      {
        projectName: "ratracer",
        content: "[LESSON] Always seed the database after migration.",
      },
      {
        projectName: "pointpartner",
        content: "[LESSON] Seed db after running migrations.",
      },
      {
        projectName: "medipal",
        content: "[LESSON] Database needs seeding post-migration.",
      },
    ];

    const suggestions = analyzeSessionPatterns(sessions);
    expect(suggestions[0].projects.length).toBeGreaterThanOrEqual(2);
  });
});
