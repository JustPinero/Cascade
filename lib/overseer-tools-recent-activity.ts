import type { Tool } from "@/lib/overseer-tools";

interface RecentActivityInput {
  projectSlug?: string;
  eventType?: string;
  limit?: number;
}

interface ActivityEventSummary {
  eventType: string;
  summary: string;
  projectSlug: string | null;
  projectName: string | null;
  createdAtISO: string;
}

interface RecentActivityOutput {
  events: ActivityEventSummary[];
  totalReturned: number;
}

export const recentActivityTool: Tool<RecentActivityInput, RecentActivityOutput> = {
  name: "get_recent_activity",
  description:
    "Get recent activity events across the fleet (or scoped to one project). Use this for 'what's happened lately?' questions. Cross-project events have null projectSlug/projectName.",
  inputSchema: {
    type: "object",
    properties: {
      projectSlug: {
        type: "string",
        description: "Restrict to one project's activity by slug.",
      },
      eventType: {
        type: "string",
        description: "Restrict to one event type (e.g. 'phase-complete').",
      },
      limit: {
        type: "number",
        description: "Cap on events returned. Default 10.",
      },
    },
  },
  handler: async (input, ctx) => {
    const limit = input.limit ?? 10;

    const where: {
      project?: { slug: string };
      eventType?: string;
    } = {};

    if (input.projectSlug) where.project = { slug: input.projectSlug };
    if (input.eventType) where.eventType = input.eventType;

    const events = await ctx.prisma.activityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { project: { select: { name: true, slug: true } } },
    });

    return {
      events: events.map((e) => ({
        eventType: e.eventType,
        summary: e.summary,
        projectSlug: e.project?.slug ?? null,
        projectName: e.project?.name ?? null,
        createdAtISO: e.createdAt.toISOString(),
      })),
      totalReturned: events.length,
    };
  },
};
