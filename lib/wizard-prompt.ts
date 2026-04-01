import { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Build the system prompt for the Claude wizard conversation.
 * Includes the selected template structure and relevant knowledge.
 */
export async function buildWizardSystemPrompt(
  prisma: PrismaClient,
  templateContent: string
): Promise<string> {
  // Fetch recent knowledge lessons for context
  const lessons = await prisma.knowledgeLesson.findMany({
    where: { severity: { in: ["critical", "important"] } },
    orderBy: { timesReferenced: "desc" },
    take: 20,
    select: { title: true, content: true, category: true },
  });

  const knowledgeSection =
    lessons.length > 0
      ? `\n\n## Relevant Knowledge from Past Projects\n${lessons
          .map((l) => `- [${l.category}] ${l.title}: ${l.content.split("\n")[0]}`)
          .join("\n")}`
      : "";

  return `You are a project architect helping a developer create a new software project.
Your job is to interview the developer about what they're building, then produce
a filled-in kickoff prompt using the template structure below.

## Interview Guidelines
1. Ask focused questions one at a time
2. Start with the project's purpose and who it's for
3. Then ask about technical requirements and constraints
4. Suggest specific technology choices with brief rationale
5. Reference relevant lessons from past projects when applicable
6. After gathering enough information, generate the complete kickoff prompt

## Template Structure
The final output should follow this template format:

${templateContent}

## Important Rules
- Be specific in your suggestions — recommend exact technologies, not lists of options
- When the developer says they're done, generate the full kickoff prompt
- Format the final output as markdown, clearly delimited with "---KICKOFF-START---" and "---KICKOFF-END---"
- Keep the conversation focused and efficient${knowledgeSection}`;
}

/**
 * Extract the generated kickoff content from Claude's response.
 */
export function extractKickoff(response: string): string | null {
  const startMarker = "---KICKOFF-START---";
  const endMarker = "---KICKOFF-END---";

  const startIdx = response.indexOf(startMarker);
  const endIdx = response.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return null;
  }

  return response
    .slice(startIdx + startMarker.length, endIdx)
    .trim();
}
