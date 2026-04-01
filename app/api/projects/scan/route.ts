import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importProjects } from "@/lib/project-import";
import { harvestKnowledge } from "@/lib/knowledge-harvester";
import { generateAdvisories } from "@/lib/advisory-engine";
import { resolveProjectsDir } from "@/lib/validators";

export async function POST() {
  try {
    const projectsDir = resolveProjectsDir();

    // 1. Scan and import projects (with real health computation)
    const importResult = await importProjects(prisma, projectsDir);

    // 2. Harvest knowledge from all projects
    const harvestResult = await harvestKnowledge(prisma);

    // 3. Generate advisories for projects with matching issues
    const advisoryResult = await generateAdvisories(prisma);

    // 4. Log scan-complete event
    await prisma.activityEvent.create({
      data: {
        eventType: "scan-complete",
        summary: `Scan complete: ${importResult.created} new, ${importResult.updated} updated, ${harvestResult.newLessons} lessons, ${advisoryResult.advisoriesWritten} advisories`,
      },
    });

    return NextResponse.json({
      scan: importResult,
      harvest: harvestResult,
      advisories: advisoryResult,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
