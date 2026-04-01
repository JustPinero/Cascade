import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

export interface ProjectScanResult {
  name: string;
  slug: string;
  path: string;
  hasClaude: boolean;
  hasGit: boolean;
  hasAudits: boolean;
  hasRequests: boolean;
  gitBranch: string | null;
  gitDirty: boolean;
  lastModified: Date;
}

export interface ScanOptions {
  /** Only re-scan projects modified after this date */
  since?: Date;
}

/**
 * Convert a project directory name to a URL-safe slug.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Check if a path exists (file or directory).
 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current git branch for a directory, or null if not a git repo.
 */
function getGitBranch(dir: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return branch;
  } catch {
    return null;
  }
}

/**
 * Check if git working tree has uncommitted changes.
 */
function isGitDirty(dir: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd: dir,
      stdio: "pipe",
    })
      .toString()
      .trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the most recent modification time of a directory (shallow).
 */
async function getDirMtime(dir: string): Promise<Date> {
  const stat = await fs.stat(dir);
  return stat.mtime;
}

/**
 * Scan a single project directory and return metadata.
 */
async function scanProject(projectDir: string): Promise<ProjectScanResult> {
  const name = path.basename(projectDir);
  const hasGit = await exists(path.join(projectDir, ".git"));

  return {
    name,
    slug: toSlug(name),
    path: projectDir,
    hasClaude: await exists(path.join(projectDir, "CLAUDE.md")),
    hasGit,
    hasAudits: await exists(path.join(projectDir, "audits")),
    hasRequests: await exists(path.join(projectDir, "requests")),
    gitBranch: hasGit ? getGitBranch(projectDir) : null,
    gitDirty: hasGit ? isGitDirty(projectDir) : false,
    lastModified: await getDirMtime(projectDir),
  };
}

/**
 * Scan PROJECTS_DIR for all project directories.
 * Returns metadata for each detected project.
 *
 * Skips hidden directories (starting with .) and node_modules.
 * With `since` option, only returns projects modified after the given date.
 */
export async function scanProjects(
  projectsDir: string,
  options: ScanOptions = {}
): Promise<ProjectScanResult[]> {
  if (!(await exists(projectsDir))) {
    return [];
  }

  const entries = await fs.readdir(projectsDir, { withFileTypes: true });
  const results: ProjectScanResult[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const projectDir = path.join(projectsDir, entry.name);

    // Incremental scanning: skip if not modified since last scan
    if (options.since) {
      try {
        const mtime = await getDirMtime(projectDir);
        if (mtime <= options.since) continue;
      } catch {
        continue;
      }
    }

    try {
      const result = await scanProject(projectDir);
      results.push(result);
    } catch {
      // Skip inaccessible directories
      continue;
    }
  }

  return results;
}
