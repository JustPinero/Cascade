import { execSync } from "child_process";

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
  const visibility = options.isPrivate ? "--private" : "--public";
  const desc = options.description
    ? `--description "${options.description.replace(/"/g, '\\"')}"`
    : "";

  try {
    const output = execSync(
      `gh repo create ${options.name} ${visibility} ${desc} --confirm 2>&1`,
      { stdio: "pipe", timeout: 30000 }
    )
      .toString()
      .trim();

    // Extract URL from output
    const urlMatch = output.match(
      /https:\/\/github\.com\/[^\s]+/
    );
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
