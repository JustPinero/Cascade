import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importProjects } from "@/lib/project-import";
import { harvestKnowledge } from "@/lib/knowledge-harvester";
import { generateAdvisories } from "@/lib/advisory-engine";
import { checkReminders } from "@/lib/reminders";
import { resolveProjectsDir } from "@/lib/validators";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(getRateLimitKey(request, "scan"), 5, 60_000);
  if (limited) return limited;

  try {
    const projectsDir = resolveProjectsDir();

    // 1. Scan and import projects (with real health computation)
    const importResult = await importProjects(prisma, projectsDir);

    // 2. Harvest knowledge from all projects
    const harvestResult = await harvestKnowledge(prisma);

    // 3. Generate advisories for projects with matching issues
    const advisoryResult = await generateAdvisories(prisma);

    // 4. Check reminders against updated project states
    const reminderResult = await checkReminders(prisma);

    // 5. Log scan-complete event
    await prisma.activityEvent.create({
      data: {
        eventType: "scan-complete",
        summary: `Scan complete: ${importResult.created} new, ${importResult.updated} updated, ${harvestResult.newLessons} lessons, ${advisoryResult.advisoriesWritten} advisories, ${reminderResult.triggered} reminders triggered`,
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
