import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

/**
 * Fleet reconciliation (phase 41.4).
 *
 * Cascade's DB picture of the fleet must survive contact with reality.
 * This module compares a Project row (path, status) against the
 * filesystem and git: dead paths, path-casing mismatches on
 * case-insensitive filesystems, dirty working trees, ahead/behind
 * drift versus origin, unpushed local branches, and status
 * contradictions ("complete" with uncommitted/unpushed work).
 *
 * Constraints (by construction):
 * - Read-only against project repos, with one sanctioned exception:
 *   `git fetch` — timeboxed and failure-tolerant (offline → remote
 *   comparisons run against last-known refs with a reason recorded,
 *   never an error).
 * - Every shell-out uses execFile with an argument array; no user/DB
 *   input is ever interpolated into a command string.
 * - Findings are a typed, extensible array (41.7 builds on this
 *   plumbing), not booleans.
 */

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The slice of a Project row the reconciler needs. */
export interface FleetProjectRecord {
  slug: string;
  name: string;
  /** Project path as recorded in the DB. */
  path: string;
  /** Project.status — building | complete | deployed | ... */
  status: string;
}

export type ReconciliationSeverity = "notice" | "warning" | "critical";

export type ReconciliationFinding =
  | {
      type: "path-missing";
      severity: "critical";
      message: string;
      dbPath: string;
    }
  | {
      type: "path-casing";
      severity: "notice";
      message: string;
      dbPath: string;
      diskPath: string;
    }
  | {
      type: "dirty-tree";
      severity: ReconciliationSeverity;
      message: string;
      dirtyCount: number;
    }
  | {
      type: "ahead-behind";
      severity: "warning";
      message: string;
      branch: string;
      remoteRef: string;
      ahead: number;
      behind: number;
    }
  | {
      type: "unpushed-branch";
      severity: "warning";
      message: string;
      branches: string[];
    }
  | {
      type: "status-drift";
      severity: "warning";
      message: string;
      status: string;
      evidence: string[];
    };

export type ReconciliationFindingType = ReconciliationFinding["type"];

export interface RemoteCheckStatus {
  /** True when remote comparisons (ahead/behind, unpushed) actually ran. */
  checked: boolean;
  /** True when a `git fetch` completed within the timebox. */
  fetched: boolean;
  /** Why remote checks were skipped, or why refs may be stale. */
  reason: string | null;
}

export interface ProjectReconciliation {
  slug: string;
  name: string;
  dbPath: string;
  /** Actual on-disk path (casing-corrected), or null when missing. */
  resolvedPath: string | null;
  findings: ReconciliationFinding[];
  remote: RemoteCheckStatus;
}

export interface FleetReconciliation {
  generatedAt: string;
  findingsCount: number;
  /** Every inspected project, drifted or not. */
  projects: ProjectReconciliation[];
  /** Only projects with at least one finding. */
  drifted: ProjectReconciliation[];
}

export interface ReconcileOptions {
  /** Run `git fetch` before remote comparisons (default true). */
  fetch?: boolean;
  /** Timebox for `git fetch` in ms (default 10s). */
  fetchTimeoutMs?: number;
  /** Timebox for local git commands in ms (default 10s). */
  gitTimeoutMs?: number;
}

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_GIT_TIMEOUT_MS = 10_000;

/** Statuses that assert "no work in flight" — contradicted by local drift. */
const SETTLED_STATUSES = new Set(["complete", "deployed", "archived"]);

/** Dirty trees this large are a warning, not a notice (labwebsite: 1,246). */
const DIRTY_WARNING_THRESHOLD = 100;

// ---------------------------------------------------------------------------
// Shell boundary — arg arrays only, timeboxed, never throws.
// ---------------------------------------------------------------------------

async function git(
  cwd: string,
  args: string[],
  timeoutMs: number
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.replace(/\n$/, "");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Path resolution — walks the path component-by-component via readdir so a
// case-insensitive filesystem (macOS default) can't hide a casing mismatch
// between the DB path and the on-disk truth.
// ---------------------------------------------------------------------------

async function resolveOnDisk(
  dbPath: string
): Promise<{ exists: boolean; actualPath: string | null }> {
  const normalized = path.resolve(dbPath);
  const parts = normalized.split(path.sep).filter(Boolean);
  let current: string = path.sep;

  for (const part of parts) {
    let entries: string[];
    try {
      entries = await fs.readdir(current);
    } catch {
      // Unreadable directory — fall back to a plain existence check;
      // casing can't be verified from here.
      try {
        await fs.access(normalized);
        return { exists: true, actualPath: null };
      } catch {
        return { exists: false, actualPath: null };
      }
    }
    if (entries.includes(part)) {
      current = path.join(current, part);
      continue;
    }
    const lower = part.toLowerCase();
    const caseInsensitive = entries.find((e) => e.toLowerCase() === lower);
    if (caseInsensitive !== undefined) {
      current = path.join(current, caseInsensitive);
      continue;
    }
    return { exists: false, actualPath: null };
  }

  return { exists: true, actualPath: current };
}

// ---------------------------------------------------------------------------
// Git checks (all read-only except the timeboxed fetch)
// ---------------------------------------------------------------------------

async function countDirtyFiles(
  repoPath: string,
  timeoutMs: number
): Promise<number> {
  const status = await git(repoPath, ["status", "--porcelain"], timeoutMs);
  if (status === null || status.length === 0) return 0;
  return status.split("\n").filter(Boolean).length;
}

interface RemoteComparison {
  remote: RemoteCheckStatus;
  aheadBehind: {
    branch: string;
    remoteRef: string;
    ahead: number;
    behind: number;
  } | null;
  unpushedBranches: string[];
}

async function compareAgainstRemote(
  repoPath: string,
  opts: Required<Pick<ReconcileOptions, "fetch" | "fetchTimeoutMs" | "gitTimeoutMs">>
): Promise<RemoteComparison> {
  const none: RemoteComparison = {
    remote: { checked: false, fetched: false, reason: null },
    aheadBehind: null,
    unpushedBranches: [],
  };

  const remotes = await git(repoPath, ["remote"], opts.gitTimeoutMs);
  const remoteName = remotes?.split("\n").map((r) => r.trim()).find(Boolean);
  if (!remoteName) {
    none.remote.reason = "no git remote configured — remote checks skipped";
    return none;
  }

  // Timeboxed, failure-tolerant fetch. Offline or unreachable remote →
  // compare against last-known remote refs and say so.
  let fetched = false;
  let reason: string | null = null;
  if (opts.fetch) {
    const fetchResult = await git(
      repoPath,
      ["fetch", "--quiet", remoteName],
      opts.fetchTimeoutMs
    );
    fetched = fetchResult !== null;
    if (!fetched) {
      reason =
        "git fetch failed or timed out (offline?) — comparing against last-known remote refs";
    }
  } else {
    reason = "fetch disabled — comparing against last-known remote refs";
  }

  // Ahead/behind for the current branch.
  let aheadBehind: RemoteComparison["aheadBehind"] = null;
  const branch = await git(
    repoPath,
    ["rev-parse", "--abbrev-ref", "HEAD"],
    opts.gitTimeoutMs
  );
  if (branch && branch !== "HEAD") {
    const remoteRef = await resolveRemoteCounterpart(
      repoPath,
      branch,
      remoteName,
      opts.gitTimeoutMs
    );
    if (remoteRef) {
      const counts = await git(
        repoPath,
        ["rev-list", "--left-right", "--count", `${remoteRef}...HEAD`],
        opts.gitTimeoutMs
      );
      const match = counts?.match(/^(\d+)\s+(\d+)$/);
      if (match) {
        aheadBehind = {
          branch,
          remoteRef,
          behind: parseInt(match[1], 10),
          ahead: parseInt(match[2], 10),
        };
      }
    }
  }

  // Unpushed branches: local branches with no remote counterpart, or with
  // commits their counterpart doesn't have.
  const unpushedBranches: string[] = [];
  const refs = await git(
    repoPath,
    [
      "for-each-ref",
      "refs/heads",
      "--format=%(refname:short)\t%(upstream:short)",
    ],
    opts.gitTimeoutMs
  );
  for (const line of refs?.split("\n").filter(Boolean) ?? []) {
    const [name, upstream] = line.split("\t");
    if (!name) continue;
    const counterpart =
      upstream ||
      (await resolveRemoteCounterpart(
        repoPath,
        name,
        remoteName,
        opts.gitTimeoutMs
      ));
    if (!counterpart) {
      unpushedBranches.push(name);
      continue;
    }
    const aheadCount = await git(
      repoPath,
      ["rev-list", "--count", `${counterpart}..${name}`],
      opts.gitTimeoutMs
    );
    if (aheadCount !== null && parseInt(aheadCount, 10) > 0) {
      unpushedBranches.push(name);
    }
  }

  return {
    remote: { checked: true, fetched, reason },
    aheadBehind,
    unpushedBranches,
  };
}

/** `<remote>/<branch>` when that remote-tracking ref exists, else null. */
async function resolveRemoteCounterpart(
  repoPath: string,
  branch: string,
  remoteName: string,
  timeoutMs: number
): Promise<string | null> {
  const ref = `refs/remotes/${remoteName}/${branch}`;
  const verified = await git(
    repoPath,
    ["rev-parse", "--verify", "--quiet", ref],
    timeoutMs
  );
  return verified ? `${remoteName}/${branch}` : null;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile one Project row against the filesystem and git.
 * Never throws — every failure mode degrades to a finding or a
 * skipped-with-reason remote status.
 */
export async function reconcileProject(
  record: FleetProjectRecord,
  options: ReconcileOptions = {}
): Promise<ProjectReconciliation> {
  const opts = {
    fetch: options.fetch !== false,
    fetchTimeoutMs: options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    gitTimeoutMs: options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
  };
  const findings: ReconciliationFinding[] = [];

  // 1. Does the DB path exist on disk (casing-aware)?
  const resolved = await resolveOnDisk(record.path);
  if (!resolved.exists) {
    findings.push({
      type: "path-missing",
      severity: "critical",
      message: `project path missing on disk: ${record.path}`,
      dbPath: record.path,
    });
    return {
      slug: record.slug,
      name: record.name,
      dbPath: record.path,
      resolvedPath: null,
      findings,
      remote: {
        checked: false,
        fetched: false,
        reason: "project path missing on disk — all checks skipped",
      },
    };
  }

  const workPath = resolved.actualPath ?? path.resolve(record.path);
  if (
    resolved.actualPath !== null &&
    resolved.actualPath !== path.resolve(record.path)
  ) {
    findings.push({
      type: "path-casing",
      severity: "notice",
      message: `DB path casing differs from disk: DB has ${record.path}, disk has ${resolved.actualPath}`,
      dbPath: record.path,
      diskPath: resolved.actualPath,
    });
  }

  // 2. Git checks — only when the project is a repo.
  let dirtyCount = 0;
  let comparison: RemoteComparison = {
    remote: { checked: false, fetched: false, reason: null },
    aheadBehind: null,
    unpushedBranches: [],
  };
  let isRepo = false;
  try {
    await fs.access(path.join(workPath, ".git"));
    isRepo = true;
  } catch {
    comparison.remote.reason = "not a git repository — git checks skipped";
  }

  if (isRepo) {
    dirtyCount = await countDirtyFiles(workPath, opts.gitTimeoutMs);
    if (dirtyCount > 0) {
      findings.push({
        type: "dirty-tree",
        severity:
          dirtyCount >= DIRTY_WARNING_THRESHOLD ? "warning" : "notice",
        message: `${dirtyCount} uncommitted file${dirtyCount === 1 ? "" : "s"} in working tree`,
        dirtyCount,
      });
    }

    comparison = await compareAgainstRemote(workPath, opts);
    if (comparison.aheadBehind) {
      const { branch, remoteRef, ahead, behind } = comparison.aheadBehind;
      if (ahead > 0 || behind > 0) {
        findings.push({
          type: "ahead-behind",
          severity: "warning",
          message: `${branch} is ${ahead} ahead / ${behind} behind ${remoteRef}`,
          branch,
          remoteRef,
          ahead,
          behind,
        });
      }
    }
    if (comparison.unpushedBranches.length > 0) {
      findings.push({
        type: "unpushed-branch",
        severity: "warning",
        message: `unpushed local branch${comparison.unpushedBranches.length === 1 ? "" : "es"}: ${comparison.unpushedBranches.join(", ")}`,
        branches: comparison.unpushedBranches,
      });
    }
  }

  // 3. Status contradiction — a "settled" status with work still in flight.
  if (SETTLED_STATUSES.has(record.status)) {
    const evidence: string[] = [];
    if (dirtyCount > 0) {
      evidence.push(`${dirtyCount} uncommitted files`);
    }
    if (comparison.unpushedBranches.length > 0) {
      evidence.push(
        `unpushed branches: ${comparison.unpushedBranches.join(", ")}`
      );
    }
    if (comparison.aheadBehind && comparison.aheadBehind.ahead > 0) {
      evidence.push(
        `${comparison.aheadBehind.branch} is ${comparison.aheadBehind.ahead} ahead of ${comparison.aheadBehind.remoteRef}`
      );
    }
    if (evidence.length > 0) {
      findings.push({
        type: "status-drift",
        severity: "warning",
        message: `status '${record.status}' contradicts local state (${evidence.join("; ")})`,
        status: record.status,
        evidence,
      });
    }
  }

  return {
    slug: record.slug,
    name: record.name,
    dbPath: record.path,
    resolvedPath: workPath,
    findings,
    remote: comparison.remote,
  };
}

/**
 * Reconcile a set of Project rows. Projects are processed concurrently;
 * a failure in one never poisons the rest.
 */
export async function reconcileFleet(
  records: FleetProjectRecord[],
  options: ReconcileOptions = {}
): Promise<FleetReconciliation> {
  const projects = await Promise.all(
    records.map((record) => reconcileProject(record, options))
  );
  const drifted = projects.filter((p) => p.findings.length > 0);
  return {
    generatedAt: new Date().toISOString(),
    findingsCount: projects.reduce((sum, p) => sum + p.findings.length, 0),
    projects,
    drifted,
  };
}

/**
 * Human-readable drift section for the morning briefing.
 * Returns null when the fleet is consistent.
 */
export function formatDriftSection(fleet: FleetReconciliation): string | null {
  if (fleet.findingsCount === 0) return null;
  const lines = fleet.drifted.map(
    (p) => `- ${p.slug}: ${p.findings.map((f) => f.message).join("; ")}`
  );
  return lines.join("\n");
}
