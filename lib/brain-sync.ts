import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Brain sync — mirror harvested [LESSON]s into the private kilroy-brain repo
 * so the existing brain pull/install flow carries them across machines.
 *
 * Cascade only WRITES files here. It performs NO git operations — the brain's
 * own harvest.sh / manual flow owns commits. This module never imports
 * child_process; the sync path shells out to nothing.
 */

export interface BrainLesson {
  /** Human-readable lesson title (source of the slug). */
  title: string;
  /** Lesson body — becomes the markdown body. */
  content: string;
  /** Source project name or slug — recorded in frontmatter. */
  sourceProject: string;
  /** ISO date (YYYY-MM-DD) — recorded in frontmatter. */
  date: string;
  /** Category/keyword tags — recorded in frontmatter. */
  tags: string[];
}

export interface BrainSyncOptions {
  /**
   * Brain repo root. Defaults to env `KILROY_BRAIN_PATH`, then `~/kilroy-brain`.
   * Tests inject a scratch dir so the real brain is never touched.
   */
  brainPath?: string;
  /** Log sink (defaults to console.log). */
  logger?: (message: string) => void;
}

export interface BrainSyncResult {
  written: boolean;
  filePath: string | null;
  reason?: "missing-brain" | "error";
}

/**
 * Resolve the brain repo root: explicit option → env → ~/kilroy-brain.
 * Expands a leading `~` to the user's home directory.
 */
export function resolveBrainPath(brainPath?: string): string {
  const raw =
    brainPath ??
    process.env.KILROY_BRAIN_PATH ??
    path.join(os.homedir(), "kilroy-brain");

  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

/**
 * Convert an arbitrary lesson title into a filesystem-safe kebab-case slug.
 * Strips diacritics, punctuation, emoji, and slashes; collapses to hyphens.
 * Never returns an empty string.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // anything not alnum → hyphen (drops emoji/punct)
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .replace(/-{2,}/g, "-"); // collapse runs

  return slug.length > 0 ? slug : "lesson";
}

/** Render the lesson as a frontmatter + body markdown document. */
function renderMarkdown(lesson: BrainLesson): string {
  const tags = lesson.tags.map((t) => `"${t.replace(/"/g, "")}"`).join(", ");
  const frontmatter = [
    "---",
    `title: "${lesson.title.replace(/"/g, "'")}"`,
    `source: ${lesson.sourceProject}`,
    `date: ${lesson.date}`,
    `tags: [${tags}]`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n${lesson.content.trim()}\n`;
}

/**
 * Mirror a single lesson into `<brain>/playbook/lessons/<slug>.md`.
 *
 * - Missing brain dir (machine without the brain) → skip silently with one log
 *   line; harvest is NEVER failed by this.
 * - Dedup by slug: re-harvesting the same lesson overwrites the same file.
 * - No git operations are performed.
 */
export async function syncLessonToBrain(
  lesson: BrainLesson,
  options: BrainSyncOptions = {}
): Promise<BrainSyncResult> {
  const log = options.logger ?? ((m: string) => console.log(m));
  const brainPath = resolveBrainPath(options.brainPath);

  // Brain absent → skip. This is the "machine without the brain" case.
  try {
    await fs.access(brainPath);
  } catch {
    log(
      `[brain-sync] brain dir not found at ${brainPath} — skipping lesson mirror`
    );
    return { written: false, filePath: null, reason: "missing-brain" };
  }

  try {
    const lessonsDir = path.join(brainPath, "playbook", "lessons");
    await fs.mkdir(lessonsDir, { recursive: true });

    const slug = slugify(lesson.title);
    const filePath = path.join(lessonsDir, `${slug}.md`);
    await fs.writeFile(filePath, renderMarkdown(lesson), "utf-8");

    return { written: true, filePath };
  } catch (err) {
    // Never fail the harvest on a mirror error.
    const message = err instanceof Error ? err.message : "unknown error";
    log(`[brain-sync] failed to mirror lesson "${lesson.title}": ${message}`);
    return { written: false, filePath: null, reason: "error" };
  }
}
