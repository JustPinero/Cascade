import type { Tool } from "@/lib/overseer-tools";
import { readChannelContent } from "@/lib/engineer-channel";

interface EngineerMessagesInput {
  maxChars?: number;
}

interface EngineerMessagesOutput {
  found: boolean;
  content: string;
}

export const engineerMessagesTool: Tool<
  EngineerMessagesInput,
  EngineerMessagesOutput
> = {
  name: "get_engineer_messages",
  description:
    "Get the most recent messages the Engineer (Kilroy — the Claude maintaining Cascade) has left for the Overseer. Use this when the engineer asks a question or notes something operationally important.",
  inputSchema: {
    type: "object",
    properties: {
      maxChars: {
        type: "number",
        description: "Truncate to the last N characters of the channel. Default 2000.",
      },
    },
  },
  handler: async (input) => {
    const max = input.maxChars ?? 2000;
    try {
      const content = await readChannelContent(process.cwd());
      if (!content) return { found: false, content: "" };
      return { found: true, content: content.slice(-max) };
    } catch {
      return { found: false, content: "" };
    }
  },
};
