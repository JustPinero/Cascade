import { describe, it, expect } from "vitest";
import {
  isValidSlug,
  isValidGithubUrl,
  isInsideProjectsDir,
  sanitizeForShell,
  isWithinLength,
} from "./validators";

describe("validators", () => {
  describe("isValidSlug", () => {
    it("accepts valid slugs", () => {
      expect(isValidSlug("my-project")).toBe(true);
      expect(isValidSlug("MyApp.v2")).toBe(true);
      expect(isValidSlug("test_repo-123")).toBe(true);
    });

    it("rejects injection patterns", () => {
      expect(isValidSlug("; rm -rf /")).toBe(false);
      expect(isValidSlug("test`whoami`")).toBe(false);
      expect(isValidSlug("test$(cat /etc/passwd)")).toBe(false);
      expect(isValidSlug("test && echo pwned")).toBe(false);
      expect(isValidSlug("test | cat")).toBe(false);
    });

    it("rejects empty and too-long strings", () => {
      expect(isValidSlug("")).toBe(false);
      expect(isValidSlug("a".repeat(101))).toBe(false);
    });
  });

  describe("isValidGithubUrl", () => {
    it("accepts valid GitHub URLs", () => {
      expect(isValidGithubUrl("https://github.com/user/repo")).toBe(true);
      expect(isValidGithubUrl("https://github.com/org/my-app.js")).toBe(true);
    });

    it("rejects non-GitHub URLs", () => {
      expect(isValidGithubUrl("https://evil.com/user/repo")).toBe(false);
      expect(isValidGithubUrl("http://github.com/user/repo")).toBe(false);
      expect(isValidGithubUrl("https://github.com/")).toBe(false);
    });

    it("rejects injection in URLs", () => {
      expect(isValidGithubUrl("https://github.com/user/repo; rm -rf /")).toBe(false);
    });
  });

  describe("isInsideProjectsDir", () => {
    it("accepts paths inside base", () => {
      expect(isInsideProjectsDir("/home/me/projects/app", "/home/me/projects")).toBe(true);
    });

    it("rejects path traversal", () => {
      expect(isInsideProjectsDir("/home/me/projects/../../../etc/passwd", "/home/me/projects")).toBe(false);
    });

    it("rejects paths outside base", () => {
      expect(isInsideProjectsDir("/tmp/evil", "/home/me/projects")).toBe(false);
    });
  });

  describe("sanitizeForShell", () => {
    it("strips dangerous characters", () => {
      expect(sanitizeForShell("hello; rm -rf /")).toBe("hello rm -rf /");
      expect(sanitizeForShell("test`whoami`")).toBe("testwhoami");
      expect(sanitizeForShell("$(evil)")).toBe("evil");
      expect(sanitizeForShell("a && b")).toBe("a  b");
    });

    it("preserves safe characters", () => {
      expect(sanitizeForShell("My Project v2.0")).toBe("My Project v2.0");
    });
  });

  describe("isWithinLength", () => {
    it("validates length bounds", () => {
      expect(isWithinLength("hello", 10)).toBe(true);
      expect(isWithinLength("hello", 3)).toBe(false);
      expect(isWithinLength("hi", 10, 5)).toBe(false);
    });
  });
});
