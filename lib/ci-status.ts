import { execSync } from "child_process";

export type CIStatus = "pass" | "fail" | "pending" | "none";

/**
 * Parse a GitHub Actions conclusion into a CIStatus.
 */
export function parseCIConclusion(conclusion: string): CIStatus {
  if (!conclusion) return "none";
  switch (conclusion) {
    case "success":
      return "pass";
    case "failure":
    case "cancelled":
    case "timed_out":
      return "fail";
    case "in_progress":
    case "queued":
      return "pending";
    default:
      return "none";
  }
}

// In-memory cache
const ciCache = new Map<string, { status: CIStatus; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get CI status for a GitHub repo.
 * Uses `gh run list` CLI. Returns cached result within TTL.
 */
export function getCIStatus(githubRepo: string | null): CIStatus {
  if (!githubRepo) return "none";

  const cached = ciCache.get(githubRepo);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  try {
    const output = execSync(
      `gh run list --repo ${githubRepo} --limit 1 --json conclusion -q ".[0].conclusion"`,
      { stdio: "pipe", timeout: 10_000 }
    ).toString().trim();

    const status = parseCIConclusion(output);
    ciCache.set(githubRepo, { status, cachedAt: Date.now() });
    return status;
  } catch {
    return "none";
  }
}
