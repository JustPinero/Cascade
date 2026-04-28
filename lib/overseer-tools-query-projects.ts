import type { Tool } from "@/lib/overseer-tools";

interface QueryProjectsInput {
  status?: string[];
  health?: string[];
  includeBackburner?: boolean;
  limit?: number;
}

interface ProjectSummary {
  slug: string;
  name: string;
  status: string;
  health: string;
  phase: string;
  progressScore: number;
  businessStage: string;
  lastActivityAtISO: string;
}

interface QueryProjectsOutput {
  projects: ProjectSummary[];
  totalReturned: number;
  filtersApplied: QueryProjectsInput;
}

export const queryProjectsTool: Tool<QueryProjectsInput, QueryProjectsOutput> = {
  name: "query_projects",
  description:
    "List projects matching optional filters. Use this to get fleet-level visibility (e.g. 'what's blocked?', 'what's currently in flight?'). Excludes backburner + archived by default; order is by most recently active.",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "array",
        items: { type: "string" },
        description: "Filter by status values (e.g. ['building', 'deployed']).",
      },
      health: {
        type: "array",
        items: { type: "string" },
        description: "Filter by health values (e.g. ['blocked', 'warning']).",
      },
      includeBackburner: {
        type: "boolean",
        description:
          "Include backburner + archived projects in the list. Default false.",
      },
      limit: {
        type: "number",
        description: "Cap on rows returned. Default 25.",
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = input.limit ?? 25;
    const includeBackburner = input.includeBackburner ?? false;

    const where: {
      status?: { in?: string[]; notIn?: string[] };
      health?: { in: string[] };
    } = {};

    if (input.status && input.status.length > 0) {
      where.status = { in: input.status };
    } else if (!includeBackburner) {
      where.status = { notIn: ["backburner", "archived"] };
    }

    if (input.health && input.health.length > 0) {
      where.health = { in: input.health };
    }

    const projects = await ctx.prisma.project.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      take: limit,
    });

    return {
      projects: projects.map((p) => ({
        slug: p.slug,
        name: p.name,
        status: p.status,
        health: p.health,
        phase: p.currentPhase,
        progressScore: p.progressScore,
        businessStage: p.businessStage,
        lastActivityAtISO: p.lastActivityAt.toISOString(),
      })),
      totalReturned: projects.length,
      filtersApplied: input,
    };
  },
};
