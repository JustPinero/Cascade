import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync, execSync } from "child_process";
import { createGitHubRepo, isGhAuthenticated } from "./github";

// 41.1 — mock the gh CLI boundary. These are unit tests: no real
// network, no real `gh` invocations (an earlier version of this file
// shelled out to an authenticated gh and actually created
// JustPinero/valid-repo-name.test on GitHub, then timed out on the
// API round-trip in later runs).
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

const execFileSyncMock = vi.mocked(execFileSync);
const execSyncMock = vi.mocked(execSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createGitHubRepo", () => {
  it("rejects invalid repo names with injection patterns", () => {
    const result = createGitHubRepo({
      name: "; rm -rf /",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid repository name");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("rejects repo names with backticks", () => {
    const result = createGitHubRepo({
      name: "test`whoami`",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("rejects empty repo names", () => {
    const result = createGitHubRepo({
      name: "",
      isPrivate: true,
    });
    expect(result.success).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("accepts valid repo names and shells out to gh with argv (no shell)", () => {
    execFileSyncMock.mockReturnValueOnce(
      Buffer.from("✓ Created repository https://github.com/justin/valid-repo-name.test\n")
    );

    const result = createGitHubRepo({
      name: "valid-repo-name.test",
      isPrivate: true,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.url).toBe("https://github.com/justin/valid-repo-name.test");
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [command, args] = execFileSyncMock.mock.calls[0];
    expect(command).toBe("gh");
    expect(args).toEqual([
      "repo",
      "create",
      "valid-repo-name.test",
      "--private",
      "--confirm",
    ]);
  });

  it("passes --public for non-private repos", () => {
    execFileSyncMock.mockReturnValueOnce(Buffer.from(""));

    const result = createGitHubRepo({
      name: "open-repo",
      isPrivate: false,
    });

    expect(result.success).toBe(true);
    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toContain("--public");
    expect(args).not.toContain("--private");
  });

  it("maps gh 'already exists' failures to a friendly error, not a validation error", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error(
        'GraphQL: Name already exists on this account (createRepository)'
      );
    });

    const result = createGitHubRepo({
      name: "valid-repo-name.test",
      isPrivate: true,
    });

    expect(result.success).toBe(false);
    expect(result.url).toBeNull();
    expect(result.error).toBe('Repository "valid-repo-name.test" already exists');
    expect(result.error).not.toContain("Invalid repository name");
  });

  it("surfaces other gh failures as-is, not as validation errors", () => {
    execFileSyncMock.mockImplementationOnce(() => {
      throw new Error("gh: authentication required");
    });

    const result = createGitHubRepo({
      name: "valid-repo-name.test",
      isPrivate: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("authentication required");
    expect(result.error).not.toContain("Invalid repository name");
  });
});

describe("isGhAuthenticated", () => {
  it("returns true when `gh auth status` exits cleanly", () => {
    execSyncMock.mockReturnValueOnce(Buffer.from("Logged in"));
    expect(isGhAuthenticated()).toBe(true);
  });

  it("returns false when `gh auth status` throws", () => {
    execSyncMock.mockImplementationOnce(() => {
      throw new Error("not logged in");
    });
    expect(isGhAuthenticated()).toBe(false);
  });
});
