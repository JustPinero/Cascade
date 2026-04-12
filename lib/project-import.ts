import { PrismaClient } from "@/app/generated/prisma/client";
import fs from "fs/promises";
import path from "path";
import { scanProjects, scanProject } from "./scanner";
import { computeHealth } from "./health-engine";
import { computeProgress } from "./progress-engine";

/**
 * Read a project's context.md or done.md if it exists.
 */
async function readProjectFile(
  projectPath: string,
  filename: string
): Promise<string | null> {
  try {
    const content = await fs.readFile(
      path.join(projectPath, ".claude", filename),
      "utf-8"
    );
    return content.trim() || null;
  } catch {
    return null;
  }
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
  projects: { name: string; slug: string; action: "created" | "updated" }[];
}

/**
 * Scan PROJECTS_DIR and create/update Project records in the database.
 * Uses upsert to ensure idempotency — running twice won't duplicate.
 * Computes real health using the health engine (debt, git, audits).
 */
export async function importProjects(
  prisma: PrismaClient,
  projectsDir: string
): Promise<ImportResult> {
  const scanResults = await scanProjects(projectsDir);

  const result: ImportResult = {
    created: 0,
    updated: 0,
    total: scanResults.length,
    projects: [],
  };

  for (const scan of scanResults) {
    const existing = await prisma.project.findUnique({
      where: { slug: scan.slug },
    });

    // Compute real health from project filesystem
    const healthResult = await computeHealth(scan.path);

    // Compute progress score using current phase/request from DB (or defaults)
    const currentPhase = existing?.currentPhase || "phase-1-foundation";
    const currentRequest = existing?.currentRequest || null;
    const progressResult = await computeProgress(
      scan.path,
      currentPhase,
      currentRequest
    );

    const healthDetails: Record<string, unknown> = {
      hasClaude: scan.hasClaude,
      hasGit: scan.hasGit,
      hasAudits: scan.hasAudits,
      hasRequests: scan.hasRequests,
      gitBranch: healthResult.details.gitBranch,
      gitDirty: healthResult.gitDirty,
      openDebtCount: healthResult.openDebtCount,
      debtItems: healthResult.details.debtItems,
      lastAuditGrade: healthResult.lastAuditGrade,
      auditFindings: healthResult.details.auditFindings,
    };
    if (healthResult.details.needsAttention) {
      healthDetails.needsAttention = healthResult.details.needsAttention;
    }

    const data = {
      name: scan.name,
      slug: scan.slug,
      path: scan.path,
      health: healthResult.health,
      healthDetails: JSON.stringify(healthDetails),
      progressScore: progressResult.total,
      progressDetails: JSON.stringify(progressResult),
    };

    if (existing) {
      await prisma.project.update({
        where: { slug: scan.slug },
        data: {
          ...data,
          lastScannedAt: new Date(),
        },
      });
      result.updated++;
      result.projects.push({
        name: scan.name,
        slug: scan.slug,
        action: "updated",
      });
    } else {
      await prisma.project.create({
        data: {
          ...data,
          lastScannedAt: new Date(),
          lastActivityAt: scan.lastModified,
        },
      });
      result.created++;
      result.projects.push({
        name: scan.name,
        slug: scan.slug,
        action: "created",
      });
    }
  }

  return result;
}

export interface SingleImportResult {
  slug: string;
  name: string;
  action: "created" | "updated";
}

/**
 * Scan and import a single project by its filesystem path.
 * Used by the session-complete webhook for targeted updates.
 */
export async function importSingleProject(
  prisma: PrismaClient,
  projectPath: string
): Promise<SingleImportResult> {
  const scan = await scanProject(projectPath);

  const existing = await prisma.project.findUnique({
    where: { slug: scan.slug },
  });

  const healthResult = await computeHealth(scan.path);

  const currentPhase = existing?.currentPhase || "phase-1-foundation";
  const currentRequest = existing?.currentRequest || null;
  const progressResult = await computeProgress(
    scan.path,
    currentPhase,
    currentRequest
  );

  const healthDetails: Record<string, unknown> = {
    hasClaude: scan.hasClaude,
    hasGit: scan.hasGit,
    hasAudits: scan.hasAudits,
    hasRequests: scan.hasRequests,
    gitBranch: healthResult.details.gitBranch,
    gitDirty: healthResult.gitDirty,
    openDebtCount: healthResult.openDebtCount,
    debtItems: healthResult.details.debtItems,
    lastAuditGrade: healthResult.lastAuditGrade,
    auditFindings: healthResult.details.auditFindings,
  };
  if (healthResult.details.needsAttention) {
    healthDetails.needsAttention = healthResult.details.needsAttention;
  }

  // Read context.md and done.md if they exist
  const [projectContext, completionCriteria] = await Promise.all([
    readProjectFile(scan.path, "context.md"),
    readProjectFile(scan.path, "done.md"),
  ]);

  const data = {
    name: scan.name,
    slug: scan.slug,
    path: scan.path,
    health: healthResult.health,
    healthDetails: JSON.stringify(healthDetails),
    progressScore: progressResult.total,
    progressDetails: JSON.stringify(progressResult),
    lastScannedAt: new Date(),
    lastSessionEndedAt: new Date(),
    ...(projectContext !== null ? { projectContext } : {}),
    ...(completionCriteria !== null ? { completionCriteria } : {}),
  };

  if (existing) {
    await prisma.project.update({
      where: { slug: scan.slug },
      data,
    });
    return { slug: scan.slug, name: scan.name, action: "updated" };
  } else {
    await prisma.project.create({
      data: {
        ...data,
        lastActivityAt: scan.lastModified,
      },
    });
    return { slug: scan.slug, name: scan.name, action: "created" };
  }
}
