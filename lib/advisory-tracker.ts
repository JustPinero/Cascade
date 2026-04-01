import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";

export interface AdvisoryStatus {
  projectName: string;
  projectSlug: string;
  hasAdvisory: boolean;
  isRead: boolean;
}

/**
 * Check if a project has consumed its advisory (renamed to -read.md).
 */
async function checkAdvisoryRead(projectPath: string): Promise<{
  hasAdvisory: boolean;
  isRead: boolean;
}> {
  const advisoryPath = path.join(
    projectPath,
    ".claude",
    "nerve-center-advisory.md"
  );
  const readPath = path.join(
    projectPath,
    ".claude",
    "nerve-center-advisory-read.md"
  );

  try {
    await fs.access(advisoryPath);
    return { hasAdvisory: true, isRead: false };
  } catch {
    // Check if the read version exists
    try {
      await fs.access(readPath);
      return { hasAdvisory: true, isRead: true };
    } catch {
      return { hasAdvisory: false, isRead: false };
    }
  }
}

/**
 * Get advisory status for all projects.
 */
export async function getAdvisoryStatuses(
  prisma: PrismaClient
): Promise<AdvisoryStatus[]> {
  const projects = await prisma.project.findMany();
  const statuses: AdvisoryStatus[] = [];

  for (const project of projects) {
    const { hasAdvisory, isRead } = await checkAdvisoryRead(project.path);
    statuses.push({
      projectName: project.name,
      projectSlug: project.slug,
      hasAdvisory,
      isRead,
    });
  }

  return statuses;
}

/**
 * Get consumption rate: how many advisories have been read vs total.
 */
export function getConsumptionRate(
  statuses: AdvisoryStatus[]
): { total: number; read: number; rate: number } {
  const withAdvisory = statuses.filter((s) => s.hasAdvisory);
  const read = withAdvisory.filter((s) => s.isRead).length;
  const total = withAdvisory.length;
  return {
    total,
    read,
    rate: total > 0 ? read / total : 0,
  };
}
