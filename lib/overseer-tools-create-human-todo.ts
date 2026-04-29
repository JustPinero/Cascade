import type { Tool } from "@/lib/overseer-tools";

const VALID_CATEGORIES = [
  "asset",
  "credential",
  "testing",
  "deploy",
  "review",
  "external",
  "other",
] as const;
const VALID_PRIORITIES = ["high", "normal", "low"] as const;

interface CreateHumanTodoInput {
  title: string;
  projectSlug?: string;
  category?: (typeof VALID_CATEGORIES)[number];
  priority?: (typeof VALID_PRIORITIES)[number];
}

interface CreateHumanTodoOutput {
  id: number;
  title: string;
  category: string;
  priority: string;
  projectSlug: string | null;
}

export const createHumanTodoTool: Tool<CreateHumanTodoInput, CreateHumanTodoOutput> = {
  name: "create_human_todo",
  description:
    "Create a manual to-do item for the developer. Structured equivalent of the [HUMAN TODO] tag. Use for things only the developer can do (upload assets, get API keys, manual testing, deploy approval, code review, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "What the developer needs to do.",
      },
      projectSlug: {
        type: "string",
        description: "Slug of the project this relates to (optional).",
      },
      category: {
        type: "string",
        enum: ["asset", "credential", "testing", "deploy", "review", "external", "other"],
        description: "Categorization for the dashboard. Default 'other'.",
      },
      priority: {
        type: "string",
        enum: ["high", "normal", "low"],
        description: "Priority. Default 'normal'.",
      },
    },
    required: ["title"],
  },
  handler: async (input, ctx) => {
    const category = input.category ?? "other";
    const priority = input.priority ?? "normal";
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`Unknown category "${category}".`);
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      throw new Error(`Unknown priority "${priority}".`);
    }

    let projectId: number | null = null;
    if (input.projectSlug) {
      const project = await ctx.prisma.project.findUnique({
        where: { slug: input.projectSlug },
      });
      projectId = project?.id ?? null;
    }

    const created = await ctx.prisma.humanTask.create({
      data: {
        title: input.title,
        category,
        priority,
        projectSlug: input.projectSlug ?? null,
        projectId,
        createdBy: "delamain",
      },
    });

    return {
      id: created.id,
      title: created.title,
      category: created.category,
      priority: created.priority,
      projectSlug: created.projectSlug,
    };
  },
};
