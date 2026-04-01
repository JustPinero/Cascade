import { PrismaClient } from "@/app/generated/prisma/client";
import { scanProjects, type ProjectScanResult } from "./scanner";

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
  projects: { name: string; slug: string; action: "created" | "updated" }[];
}

/**
 * Scan PROJECTS_DIR and create/update Project records in the database.
 * Uses upsert to ensure idempotency — running twice won't duplicate.
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

    const data = buildProjectData(scan);

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

function buildProjectData(scan: ProjectScanResult) {
  const health = deriveHealth(scan);

  return {
    name: scan.name,
    slug: scan.slug,
    path: scan.path,
    health,
    healthDetails: JSON.stringify({
      hasClaude: scan.hasClaude,
      hasGit: scan.hasGit,
      hasAudits: scan.hasAudits,
      hasRequests: scan.hasRequests,
      gitBranch: scan.gitBranch,
      gitDirty: scan.gitDirty,
    }),
  };
}

function deriveHealth(scan: ProjectScanResult): string {
  if (!scan.hasGit) return "idle";
  if (!scan.hasClaude) return "warning";
  return "healthy";
}
