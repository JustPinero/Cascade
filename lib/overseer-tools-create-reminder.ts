import type { Tool } from "@/lib/overseer-tools";

const VALID_TYPES = [
  "project-health",
  "phase-complete",
  "project-deployed",
  "custom",
] as const;
type ConditionType = (typeof VALID_TYPES)[number];

interface CreateReminderInput {
  conditionType: ConditionType;
  conditionValue: string;
  message: string;
  projectSlug?: string;
}

interface CreateReminderOutput {
  id: number;
  message: string;
  conditionType: string;
  conditionValue: string;
}

export const createReminderTool: Tool<CreateReminderInput, CreateReminderOutput> = {
  name: "create_reminder",
  description:
    "Create a reminder that fires when a condition becomes true. Structured equivalent of the [REMINDER] tag. Examples: ramp-up of a project's health, completion of a phase, deployment going live, or a freeform date-based note.",
  inputSchema: {
    type: "object",
    properties: {
      conditionType: {
        type: "string",
        enum: ["project-health", "phase-complete", "project-deployed", "custom"],
        description:
          "What kind of trigger fires this. Use 'custom' for freeform / time-based notes.",
      },
      conditionValue: {
        type: "string",
        description:
          "The trigger value: 'slug:healthy' or 'slug:phase-3' or 'slug' or freeform text.",
      },
      message: {
        type: "string",
        description: "Human-readable reminder body.",
      },
      projectSlug: {
        type: "string",
        description: "Optional project slug this reminder relates to.",
      },
    },
    required: ["conditionType", "conditionValue", "message"],
  },
  handler: async (input, ctx) => {
    if (!VALID_TYPES.includes(input.conditionType)) {
      throw new Error(
        `Unknown conditionType "${input.conditionType}". Valid: ${VALID_TYPES.join(", ")}.`
      );
    }
    const created = await ctx.prisma.reminder.create({
      data: {
        message: input.message,
        conditionType: input.conditionType,
        conditionValue: input.conditionValue,
        projectSlug: input.projectSlug ?? null,
        createdBy: "delamain",
      },
    });
    return {
      id: created.id,
      message: created.message,
      conditionType: created.conditionType,
      conditionValue: created.conditionValue,
    };
  },
};
