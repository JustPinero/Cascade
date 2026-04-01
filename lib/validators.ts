import path from "path";
import os from "os";

/**
 * Validate a string is safe for use as a slug/repo name.
 * Only allows alphanumeric, dots, hyphens, and underscores.
 */
export function isValidSlug(s: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(s) && s.length > 0 && s.length <= 100;
}

/**
 * Validate a GitHub URL.
 */
export function isValidGithubUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(url);
}

/**
 * Resolve PROJECTS_DIR, handling ~ prefix.
 */
export function resolveProjectsDir(): string {
  const dir = process.env.PROJECTS_DIR || "~/Desktop/projects";
  if (dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return path.resolve(dir);
}

/**
 * Validate a path is inside the configured PROJECTS_DIR.
 * Prevents path traversal attacks.
 */
export function isInsideProjectsDir(
  targetPath: string,
  baseDir?: string
): boolean {
  const base = baseDir || resolveProjectsDir();
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

/**
 * Sanitize a string for safe inclusion in shell commands.
 * Strips characters that could enable injection.
 */
export function sanitizeForShell(s: string): string {
  return s.replace(/[`$\\;"'|&<>(){}!\n\r]/g, "");
}

/**
 * Validate a string length is within bounds.
 */
export function isWithinLength(
  s: string,
  max: number,
  min: number = 0
): boolean {
  return s.length >= min && s.length <= max;
}
