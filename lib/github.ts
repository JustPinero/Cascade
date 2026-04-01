import { execFileSync, execSync } from "child_process";
import { isValidSlug, sanitizeForShell } from "./validators";

export interface CreateRepoOptions {
  name: string;
  isPrivate: boolean;
  description?: string;
}

export interface CreateRepoResult {
  success: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Create a GitHub repository using the gh CLI.
 */
export function createGitHubRepo(
  options: CreateRepoOptions
): CreateRepoResult {
  if (!isValidSlug(options.name)) {
    return {
      success: false,
      url: null,
      error: `Invalid repository name: "${options.name}". Only alphanumeric, dots, hyphens, and underscores allowed.`,
    };
  }

  const args = [
    "repo",
    "create",
    options.name,
    options.isPrivate ? "--private" : "--public",
    "--confirm",
  ];

  if (options.description) {
    args.push("--description", sanitizeForShell(options.description));
  }

  try {
    const output = execFileSync("gh", args, {
      stdio: "pipe",
      timeout: 30000,
    })
      .toString()
      .trim();

    const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
    const url = urlMatch ? urlMatch[0] : `https://github.com/${options.name}`;

    return { success: true, url, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error creating repo";

    if (message.includes("already exists")) {
      return {
        success: false,
        url: null,
        error: `Repository "${options.name}" already exists`,
      };
    }

    return { success: false, url: null, error: message };
  }
}

/**
 * Check if the gh CLI is authenticated.
 */
export function isGhAuthenticated(): boolean {
  try {
    execSync("gh auth status", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
