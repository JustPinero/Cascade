import { PrismaClient } from "@/app/generated/prisma/client";

export interface ReminderData {
  id: number;
  message: string;
  conditionType: string;
  conditionValue: string;
  projectSlug: string | null;
  status: string;
  createdBy: string;
  createdAt: Date;
  triggeredAt: Date | null;
}

/**
 * Check all pending reminders against current project states.
 * Triggers reminders whose conditions are met.
 */
export async function checkReminders(
  prisma: PrismaClient
): Promise<{ triggered: number; reminders: ReminderData[] }> {
  const pending = await prisma.reminder.findMany({
    where: { status: "pending" },
  });

  if (pending.length === 0) {
    return { triggered: 0, reminders: [] };
  }

  const projects = await prisma.project.findMany();
  const projectMap = new Map(projects.map((p) => [p.slug, p]));

  const triggered: ReminderData[] = [];

  for (const reminder of pending) {
    let conditionMet = false;

    switch (reminder.conditionType) {
      case "project-health": {
        // conditionValue format: "slug:health" e.g., "ratracer:healthy"
        const [slug, targetHealth] = reminder.conditionValue.split(":");
        const project = projectMap.get(slug);
        if (project && project.health === targetHealth) {
          conditionMet = true;
        }
        break;
      }

      case "phase-complete": {
        // conditionValue format: "slug:phase-N" e.g., "ratracer:phase-3"
        const [slug, targetPhase] = reminder.conditionValue.split(":");
        const project = projectMap.get(slug);
        if (project) {
          const currentNum = parseInt(
            project.currentPhase.match(/phase-(\d+)/)?.[1] || "0"
          );
          const targetNum = parseInt(
            targetPhase.match(/(\d+)/)?.[1] || "999"
          );
          if (currentNum > targetNum) {
            conditionMet = true;
          }
        }
        break;
      }

      case "project-deployed": {
        // conditionValue is the slug
        const project = projectMap.get(reminder.conditionValue);
        if (project && project.status === "deployed") {
          conditionMet = true;
        }
        break;
      }

      case "custom": {
        // Custom reminders are triggered manually or by Delamain
        // They stay pending until explicitly triggered
        break;
      }
    }

    if (conditionMet) {
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: "triggered", triggeredAt: new Date() },
      });
      triggered.push({ ...reminder, status: "triggered", triggeredAt: new Date() });
    }
  }

  return { triggered: triggered.length, reminders: triggered };
}

/**
 * Parse [REMINDER] tags from Delamain's responses.
 * Format: [REMINDER] condition_type:condition_value — message
 */
export function parseReminders(
  content: string
): { conditionType: string; conditionValue: string; message: string; projectSlug: string | null }[] {
  const reminders: {
    conditionType: string;
    conditionValue: string;
    message: string;
    projectSlug: string | null;
  }[] = [];

  const regex =
    /\[REMINDER\]\s*([\w-]+):([\w-:]+)\s*(?:—|-)\s*(.+)/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const conditionType = match[1];
    const conditionValue = match[2];
    const message = match[3].trim();

    // Extract project slug from condition value if present
    const slugMatch = conditionValue.match(/^([\w-]+):/);
    const projectSlug = slugMatch ? slugMatch[1] : null;

    reminders.push({ conditionType, conditionValue, message, projectSlug });
  }

  return reminders;
}
