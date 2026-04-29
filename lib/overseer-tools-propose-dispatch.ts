import type { Tool } from "@/lib/overseer-tools";
import { appendToWorkingMemoryList } from "@/lib/chat-session";

const VALID_MODES = ["continue", "audit", "investigate", "custom"] as const;
type DispatchMode = (typeof VALID_MODES)[number];

interface ProposeDispatchInput {
  slug: string;
  mode: DispatchMode;
  instructions?: string;
}

interface DispatchProposal {
  slug: string;
  mode: DispatchMode;
  instructions?: string;
  proposedAtISO: string;
}

interface ProposeDispatchOutput {
  proposal: DispatchProposal;
  totalProposed: number;
}

export const proposeDispatchTool: Tool<ProposeDispatchInput, ProposeDispatchOutput> = {
  name: "propose_dispatch",
  description:
    "Record a proposed dispatch in this session's working memory. Use this whenever you'd otherwise emit a [DISPATCH] tag — it's the structured equivalent. The user reviews proposals and explicitly executes them; nothing is dispatched until they click Execute Sprint.",
  inputSchema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Lowercase, hyphenated project slug.",
      },
      mode: {
        type: "string",
        enum: ["continue", "audit", "investigate", "custom"],
        description: "Dispatch mode.",
      },
      instructions: {
        type: "string",
        description:
          "Optional free-text guidance for the dispatched session (e.g. 'focus on finishing the auth tests').",
      },
    },
    required: ["slug", "mode"],
  },
  handler: async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error(
        "propose_dispatch requires ctx.sessionId; route did not bind a session"
      );
    }
    if (!VALID_MODES.includes(input.mode)) {
      throw new Error(
        `Unknown mode "${input.mode}". Valid: ${VALID_MODES.join(", ")}.`
      );
    }

    // Phase 14.3 — verify the project exists. Otherwise the model can
    // record a proposal for a misspelled or hallucinated slug; later
    // when the user clicks Execute Sprint, the dispatch endpoint
    // fails with a confusing 404. Catch it at proposal time.
    const exists = await ctx.prisma.project.findUnique({
      where: { slug: input.slug },
      select: { slug: true },
    });
    if (!exists) {
      throw new Error(
        `Unknown project slug "${input.slug}". Call query_projects to see what's registered.`
      );
    }

    const proposal: DispatchProposal = {
      slug: input.slug,
      mode: input.mode,
      proposedAtISO: new Date().toISOString(),
    };
    if (input.instructions) proposal.instructions = input.instructions;

    // Atomic append (Phase 13.1) — closes the read-modify-write race
    // that previously lost concurrent proposals.
    const { total } = await appendToWorkingMemoryList(
      ctx.prisma,
      ctx.sessionId,
      "proposedDispatches",
      proposal
    );

    return { proposal, totalProposed: total };
  },
};
