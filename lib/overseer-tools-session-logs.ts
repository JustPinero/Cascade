import type { Tool } from "@/lib/overseer-tools";
import { getSessionLogs } from "@/lib/session-reader";

interface SessionLogsInput {
  slug: string;
  limit?: number;
}

interface SessionLogSummary {
  filename: string;
  timestamp: string;
  summary: string;
}

interface SessionLogsOutput {
  found: boolean;
  slug: string;
  logs: SessionLogSummary[];
}

export const sessionLogsTool: Tool<SessionLogsInput, SessionLogsOutput> = {
  name: "get_session_logs",
  description:
    "Get recent Claude Code session logs for a project. Use this when the developer asks 'what happened on X last session?' Each log has a filename, timestamp, and a truncated summary of the session's handoff content.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "The project's slug." },
      limit: {
        type: "number",
        description: "How many recent logs to return. Default 1.",
      },
    },
    required: ["slug"],
  },
  handler: async (input, ctx) => {
    const limit = input.limit ?? 1;
    const project = await ctx.prisma.project.findUnique({
      where: { slug: input.slug },
    });
    if (!project) return { found: false, slug: input.slug, logs: [] };

    try {
      const logs = await getSessionLogs(project.path, limit);
      return {
        found: true,
        slug: input.slug,
        logs: logs.map((l) => ({
          filename: l.filename,
          timestamp: l.timestamp,
          summary: l.summary,
        })),
      };
    } catch {
      // Sessions directory may not exist; treat as empty rather than throwing.
      return { found: true, slug: input.slug, logs: [] };
    }
  },
};
