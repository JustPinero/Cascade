import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  retroHarvestProject,
  retroHarvestAll,
} from "@/lib/retroactive-harvester";

/**
 * POST /api/knowledge/harvest-history
 *
 * Retroactively harvest lessons from project history using Claude.
 * Body: { slug?: string } — harvest one project or all if no slug.
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-")) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { slug } = body as { slug?: string };

    if (slug) {
      // Harvest a single project
      const project = await prisma.project.findUnique({
        where: { slug },
      });
      if (!project) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const result = await retroHarvestProject(
        prisma,
        project.path,
        project.name,
        project.slug,
        apiKey
      );

      return NextResponse.json(result);
    } else {
      // Harvest all projects
      const results = await retroHarvestAll(prisma, apiKey);

      const totalLessons = results.reduce(
        (sum, r) => sum + r.lessonsStored,
        0
      );
      const totalDuplicates = results.reduce(
        (sum, r) => sum + r.duplicatesSkipped,
        0
      );

      return NextResponse.json({
        projects: results,
        totalLessons,
        totalDuplicates,
        totalProjects: results.length,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
