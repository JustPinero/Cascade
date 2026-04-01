import { describe, it, expect } from "vitest";
import { createGitHubRepo } from "./github";

describe("createGitHubRepo", () => {
  it("rejects invalid repo names with injection patterns", () => {
    const result = createGitHubRepo({
      name: "; rm -rf /",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid repository name");
  });

  it("rejects repo names with backticks", () => {
    const result = createGitHubRepo({
      name: "test`whoami`",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty repo names", () => {
    const result = createGitHubRepo({
      name: "",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid repo names", () => {
    // This will fail to create since gh CLI may not be authenticated in test,
    // but it should NOT fail on validation
    const result = createGitHubRepo({
      name: "valid-repo-name.test",
      isPrivate: true,
    });
    // Either succeeds or fails on gh CLI — not on validation
    if (!result.success) {
      expect(result.error).not.toContain("Invalid repository name");
    }
  });
});
