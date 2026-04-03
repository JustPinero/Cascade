import fs from "fs/promises";
import path from "path";

export interface SessionLog {
  filename: string;
  timestamp: string;
  content: string;
  summary: string;
}

const SUMMARY_MAX_LENGTH = 500;

/**
 * Parse a session filename into an ISO-ish timestamp.
 * "2026-04-03T09-15-00.md" → "2026-04-03T09:15:00"
 */
function parseTimestamp(filename: string): string {
  const base = filename.replace(/\.md$/, "");
  // Replace hyphens in time portion with colons: T09-15-00 → T09:15:00
  const match = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
  if (match) {
    return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`;
  }
  return base;
}

/**
 * Read session logs from a project's .claude/sessions/ directory.
 * Returns logs sorted newest-first, with content and truncated summary.
 */
export async function getSessionLogs(
  projectPath: string,
  limit?: number
): Promise<SessionLog[]> {
  const sessionsDir = path.join(projectPath, ".claude", "sessions");

  try {
    const entries = await fs.readdir(sessionsDir);
    const mdFiles = entries
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    const filesToRead = limit ? mdFiles.slice(0, limit) : mdFiles;

    const logs: SessionLog[] = [];
    for (const filename of filesToRead) {
      const content = await fs.readFile(
        path.join(sessionsDir, filename),
        "utf-8"
      );
      logs.push({
        filename,
        timestamp: parseTimestamp(filename),
        content,
        summary: content.slice(0, SUMMARY_MAX_LENGTH),
      });
    }

    return logs;
  } catch {
    return [];
  }
}
