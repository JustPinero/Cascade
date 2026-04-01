import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

export interface HealthResult {
  health: "healthy" | "warning" | "blocked" | "idle";
  openDebtCount: number;
  gitDirty: boolean;
  lastAuditGrade: string | null;
  details: {
    debtItems: string[];
    gitBranch: string | null;
    hasUncommittedChanges: boolean;
    auditFindings: number;
  };
}

/**
 * Read audits/debt.md and count open debt items.
 */
async function countOpenDebt(
  projectPath: string
): Promise<{ count: number; items: string[] }> {
  const debtPath = path.join(projectPath, "audits", "debt.md");
  try {
    const content = await fs.readFile(debtPath, "utf-8");
    const openSection = content.split("## Open")[1]?.split("##")[0] || "";
    const items = openSection
      .split("\n")
      .filter((line) => line.startsWith("- ") || line.startsWith("* "))
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean);
    return { count: items.length, items };
  } catch {
    return { count: 0, items: [] };
  }
}

/**
 * Check git status for uncommitted changes.
 */
async function checkGitStatus(projectPath: string): Promise<{
  dirty: boolean;
  branch: string | null;
}> {
  // Check for .git directory to avoid inheriting parent repo
  try {
    await fs.access(path.join(projectPath, ".git"));
  } catch {
    return { dirty: false, branch: null };
  }

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectPath,
      stdio: "pipe",
    })
      .toString()
      .trim();

    const status = execSync("git status --porcelain", {
      cwd: projectPath,
      stdio: "pipe",
    })
      .toString()
      .trim();

    return { dirty: status.length > 0, branch };
  } catch {
    return { dirty: false, branch: null };
  }
}

/**
 * Parse the most recent audit snapshot grade from audit files.
 */
async function getLastAuditGrade(
  projectPath: string
): Promise<{ grade: string | null; findingsCount: number }> {
  const auditsDir = path.join(projectPath, "audits");
  try {
    const entries = await fs.readdir(auditsDir);
    const auditFiles = entries
      .filter((f) => f.startsWith("audit-") && f.endsWith(".md"))
      .sort()
      .reverse();

    if (auditFiles.length === 0) {
      return { grade: null, findingsCount: 0 };
    }

    const content = await fs.readFile(
      path.join(auditsDir, auditFiles[0]),
      "utf-8"
    );

    // Look for grade pattern like "Grade: A" or "## Grade: B"
    const gradeMatch = content.match(/grade:\s*(Critical|[A-F])/i);
    const grade = gradeMatch ? gradeMatch[1] : null;

    // Count findings (lines starting with - [BUG], - [ISSUE], etc.)
    const findings = content
      .split("\n")
      .filter((line) => /^-\s*\[(BUG|ISSUE|WARN|CRITICAL|OPT|MEM)/i.test(line));

    return { grade, findingsCount: findings.length };
  } catch {
    return { grade: null, findingsCount: 0 };
  }
}

/**
 * Compute health for a project by reading its filesystem.
 */
export async function computeHealth(
  projectPath: string
): Promise<HealthResult> {
  const [debt, git, audit] = await Promise.all([
    countOpenDebt(projectPath),
    checkGitStatus(projectPath),
    getLastAuditGrade(projectPath),
  ]);

  let health: HealthResult["health"] = "idle";

  if (git.branch === null) {
    // No git — idle
    health = "idle";
  } else if (
    audit.grade === "Critical" ||
    debt.count >= 5 ||
    audit.findingsCount >= 10
  ) {
    health = "blocked";
  } else if (
    debt.count > 0 ||
    git.dirty ||
    audit.grade === "C" ||
    audit.grade === "D" ||
    audit.grade === "F"
  ) {
    health = "warning";
  } else {
    health = "healthy";
  }

  return {
    health,
    openDebtCount: debt.count,
    gitDirty: git.dirty,
    lastAuditGrade: audit.grade,
    details: {
      debtItems: debt.items,
      gitBranch: git.branch,
      hasUncommittedChanges: git.dirty,
      auditFindings: audit.findingsCount,
    },
  };
}
