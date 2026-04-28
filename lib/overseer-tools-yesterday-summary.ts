import type { Tool } from "@/lib/overseer-tools";

interface YesterdaySummaryInput {
  daysAgo?: number; // 1 = yesterday (default), 2 = day before, etc.
  perMessageMaxChars?: number;
}

interface YesterdaySummaryOutput {
  date: string;
  messages: { content: string; createdAtISO: string }[];
  found: boolean;
}

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

export const yesterdaySummaryTool: Tool<
  YesterdaySummaryInput,
  YesterdaySummaryOutput
> = {
  name: "get_yesterday_summary",
  description:
    "Get the last 3 assistant messages from a previous day's chat (yesterday by default). Use this for continuity — referencing what was planned or decided in a prior session.",
  inputSchema: {
    type: "object",
    properties: {
      daysAgo: {
        type: "number",
        description:
          "How many days back to look (1 = yesterday, 2 = the day before, etc.). Default 1.",
      },
      perMessageMaxChars: {
        type: "number",
        description: "Truncate each message to this many chars. Default 300.",
      },
    },
  },
  handler: async (input, ctx) => {
    const daysAgo = input.daysAgo ?? 1;
    const perMax = input.perMessageMaxChars ?? 300;
    const date = dateNDaysAgo(daysAgo);

    const rows = await ctx.prisma.chatMessage.findMany({
      where: { sessionDate: date, role: "assistant" },
      orderBy: { createdAt: "desc" },
      take: 3,
    });

    const messages = rows
      .map((m) => ({
        content: m.content.slice(0, perMax),
        createdAtISO: m.createdAt.toISOString(),
      }))
      .reverse(); // chronological order for readability

    return { date, messages, found: messages.length > 0 };
  },
};
