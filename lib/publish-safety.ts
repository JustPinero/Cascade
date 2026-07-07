import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Publish-safety & secret-hygiene audit (phase 41.3).
 *
 * Detects the incident class that cost a git history rewrite on
 * 2026-07-07: ephemeral session files tracked in git, secret patterns in
 * tracked files, and credentials embedded in .claude/settings.local.json
 * permission strings — with severity escalated when the repo's origin is
 * public.
 *
 * Constraints (by construction):
 * - READ-ONLY against target repos: only `git ls-files` and file reads.
 *   The audit never modifies project files or git state.
 * - Raw secret values never cross a function boundary: pattern matching
 *   returns only a redacted form (first 10 chars + ellipsis), so nothing
 *   downstream — findings, DB rows, logs — can contain the raw value.
 */

export type RepoVisibility = "public" | "private" | "unknown";

/** Injectable boundary for `gh repo view --json visibility`. */
export type VisibilityProbe = (projectPath: string) => RepoVisibility;

export type PublishSafetyClass =
  | "tracked-ephemeral"
  | "tracked-secret"
  | "settings-credential";

export type PublishSafetySeverity = "normal" | "high";

export interface PublishSafetyFinding {
  class: PublishSafetyClass;
  /** Repo-relative file path. */
  file: string;
  /** Short human label for what matched (pattern name or file class). */
  label: string;
  /** Redacted, human-readable description. Never contains raw secrets. */
  detail: string;
  severity: PublishSafetySeverity;
  /** HumanTask category this finding escalates to. */
  category: "credential" | "review";
  /** Stable identity for idempotent task creation. */
  fingerprint: string;
}

export interface PublishSafetyResult {
  findings: PublishSafetyFinding[];
  repoVisibility: RepoVisibility;
}

export interface PublishSafetyOptions {
  visibilityProbe?: VisibilityProbe;
}

export interface PublishSafetySummary {
  findingsCount: number;
  highSeverityCount: number;
  repoVisibility: RepoVisibility;
  findings: PublishSafetyFinding[];
}

// ---------------------------------------------------------------------------
// Secret patterns — ported from the coqui-kickoff secret-scan hook, plus
// postgres:// URLs with embedded passwords and sbp_/sntrys_ tokens.
// Order matters only for readability; every pattern is checked per file.
// ---------------------------------------------------------------------------

interface SecretPattern {
  label: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { label: "Anthropic API key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { label: "OpenAI-style secret key", regex: /sk-[A-Za-z0-9]{20,}/ },
  { label: "GitHub token", regex: /ghp_[A-Za-z0-9]{20,}/ },
  { label: "GitHub fine-grained token", regex: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "AWS access key", regex: /AKIA[0-9A-Z]{16}/ },
  {
    label: "Private key block",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  { label: "Slack token", regex: /xox[bpars]-[A-Za-z0-9-]{10,}/ },
  {
    label: "Postgres URL with embedded password",
    regex: /postgres(?:ql)?:\/\/[^/\s:@'"]+:[^@\s'"]+@[^\s'")]+/,
  },
  { label: "Supabase token", regex: /sbp_[A-Za-z0-9]{16,}/ },
  { label: "Sentry token", regex: /sntrys_[A-Za-z0-9+/=_.-]{16,}/ },
];

/**
 * Ephemeral session files that must never be tracked in git.
 * `.env*` is flagged unless it is an `.example` variant.
 */
const EPHEMERAL_PATH_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "session handoff", regex: /(^|\/)\.claude\/handoff\.md$/ },
  { label: "kilroy channel", regex: /(^|\/)\.claude\/kilroy-channel\.md$/ },
  { label: "session log", regex: /(^|\/)\.claude\/sessions\// },
  {
    label: "local Claude settings",
    regex: /(^|\/)\.claude\/settings\.local\.json$/,
  },
  { label: "env file", regex: /(^|\/)\.env[^/]*$/ },
];

const ENV_EXAMPLE_REGEX = /\.example$/;

/** Skip content scans on files larger than this (bytes). */
const MAX_SCAN_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// Redaction — the ONLY code that touches a raw match. Returns the redacted
// form immediately; the raw value never escapes this function.
// ---------------------------------------------------------------------------

function matchSecretsRedacted(
  text: string
): { label: string; redacted: string }[] {
  const hits: { label: string; redacted: string }[] = [];
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (match) {
      hits.push({ label: pattern.label, redacted: match[0].slice(0, 10) + "…" });
    }
  }
  return hits;
}

function fingerprintOf(
  cls: PublishSafetyClass,
  file: string,
  label: string,
  redacted: string
): string {
  return crypto
    .createHash("sha256")
    .update(`${cls}|${file}|${label}|${redacted}`)
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Repo visibility — `gh repo view --json visibility` behind an injectable,
// cached boundary. Unknown / no remote / gh failure → "unknown", which is
// treated as private for severity purposes.
// ---------------------------------------------------------------------------

const VISIBILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const visibilityCache = new Map<string, { value: RepoVisibility; at: number }>();

export function clearVisibilityCache(): void {
  visibilityCache.clear();
}

export const defaultVisibilityProbe: VisibilityProbe = (projectPath) => {
  try {
    // No remote → nothing published; skip the gh network call entirely.
    const remotes = execFileSync("git", ["remote"], {
      cwd: projectPath,
      stdio: "pipe",
      timeout: 10000,
    })
      .toString()
      .trim();
    if (remotes.length === 0) return "unknown";
    const output = execFileSync(
      "gh",
      ["repo", "view", "--json", "visibility"],
      { cwd: projectPath, stdio: "pipe", timeout: 15000 }
    ).toString();
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "visibility" in parsed &&
      typeof (parsed as { visibility: unknown }).visibility === "string"
    ) {
      const visibility = (parsed as { visibility: string }).visibility.toLowerCase();
      if (visibility === "public") return "public";
      if (visibility === "private" || visibility === "internal") return "private";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
};

function resolveVisibility(
  projectPath: string,
  probe: VisibilityProbe
): RepoVisibility {
  const cached = visibilityCache.get(projectPath);
  if (cached && Date.now() - cached.at < VISIBILITY_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = probe(projectPath);
  visibilityCache.set(projectPath, { value, at: Date.now() });
  return value;
}

// ---------------------------------------------------------------------------
// Scanning helpers (all read-only)
// ---------------------------------------------------------------------------

function listTrackedFiles(projectPath: string): string[] {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: projectPath,
      stdio: "pipe",
      timeout: 30000,
    })
      .toString()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function readScannableFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return null;
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) return null; // binary
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

/** Collect every string value in a parsed JSON structure. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

interface RawFinding {
  class: PublishSafetyClass;
  file: string;
  label: string;
  detailBase: string;
  category: "credential" | "review";
  redacted: string;
}

/**
 * Run the publish-safety audit against a project directory.
 * Read-only: never modifies project files or git state.
 * The visibility probe is only invoked when findings exist (and its result
 * is cached per project path).
 */
export async function auditPublishSafety(
  projectPath: string,
  options: PublishSafetyOptions = {}
): Promise<PublishSafetyResult> {
  const probe = options.visibilityProbe ?? defaultVisibilityProbe;
  const raw: RawFinding[] = [];

  // Only repos have tracked files.
  let tracked: string[] = [];
  try {
    await fs.access(path.join(projectPath, ".git"));
    tracked = listTrackedFiles(projectPath);
  } catch {
    tracked = [];
  }

  // Class 1 — ephemeral session files tracked in git.
  for (const file of tracked) {
    for (const pattern of EPHEMERAL_PATH_PATTERNS) {
      if (!pattern.regex.test(file)) continue;
      if (pattern.label === "env file" && ENV_EXAMPLE_REGEX.test(file)) continue;
      raw.push({
        class: "tracked-ephemeral",
        file,
        label: pattern.label,
        detailBase: `Tracked ephemeral file (${pattern.label}): ${file}`,
        category: "review",
        redacted: "",
      });
      break; // one ephemeral finding per file
    }
  }

  // Class 2 — secret patterns in tracked file contents.
  for (const file of tracked) {
    const content = await readScannableFile(path.join(projectPath, file));
    if (content === null) continue;
    for (const hit of matchSecretsRedacted(content)) {
      raw.push({
        class: "tracked-secret",
        file,
        label: hit.label,
        detailBase: `${hit.label} in tracked file ${file}: ${hit.redacted}`,
        category: "credential",
        redacted: hit.redacted,
      });
    }
  }

  // Class 3 — credentials embedded in .claude/settings.local.json
  // permission strings (tracked or not).
  const settingsRel = ".claude/settings.local.json";
  const settingsContent = await readScannableFile(
    path.join(projectPath, settingsRel)
  );
  if (settingsContent !== null) {
    let strings: string[] = [];
    try {
      strings = collectStrings(JSON.parse(settingsContent));
    } catch {
      // Malformed JSON — scan the raw text instead.
      strings = [settingsContent];
    }
    const seen = new Set<string>();
    for (const value of strings) {
      for (const hit of matchSecretsRedacted(value)) {
        const key = `${hit.label}|${hit.redacted}`;
        if (seen.has(key)) continue;
        seen.add(key);
        raw.push({
          class: "settings-credential",
          file: settingsRel,
          label: hit.label,
          detailBase: `${hit.label} embedded in ${settingsRel} permission string: ${hit.redacted}`,
          category: "credential",
          redacted: hit.redacted,
        });
      }
    }
  }

  // Severity — only probe visibility when there is something to escalate.
  let repoVisibility: RepoVisibility = "unknown";
  if (raw.length > 0) {
    repoVisibility = resolveVisibility(projectPath, probe);
  }
  const severity: PublishSafetySeverity =
    repoVisibility === "public" ? "high" : "normal";

  const findings: PublishSafetyFinding[] = raw.map((f) => ({
    class: f.class,
    file: f.file,
    label: f.label,
    detail: f.detailBase,
    severity,
    category: f.category,
    fingerprint: fingerprintOf(f.class, f.file, f.label, f.redacted),
  }));

  return { findings, repoVisibility };
}

export function summarizePublishSafety(
  result: PublishSafetyResult
): PublishSafetySummary {
  return {
    findingsCount: result.findings.length,
    highSeverityCount: result.findings.filter((f) => f.severity === "high")
      .length,
    repoVisibility: result.repoVisibility,
    findings: result.findings,
  };
}

// ---------------------------------------------------------------------------
// Escalation — idempotent HumanTask creation (one task per distinct finding
// across runs). Titles are deterministic (built from redacted details), so
// (title, projectSlug) identifies a finding across runs.
// ---------------------------------------------------------------------------

export interface SyncTasksResult {
  created: number;
  existing: number;
}

export async function syncPublishSafetyTasks(
  prisma: PrismaClient,
  project: { slug: string; id?: number | null },
  findings: PublishSafetyFinding[]
): Promise<SyncTasksResult> {
  let created = 0;
  let existing = 0;

  for (const finding of findings) {
    const title = `[publish-safety] ${finding.detail}`;
    const match = await prisma.humanTask.findFirst({
      where: { title, projectSlug: project.slug },
    });
    if (match) {
      existing++;
      continue;
    }
    await prisma.humanTask.create({
      data: {
        title,
        category: finding.category,
        priority: finding.severity === "high" ? "high" : "normal",
        projectSlug: project.slug,
        projectId: project.id ?? null,
        createdBy: "cascade",
      },
    });
    created++;
  }

  return { created, existing };
}
