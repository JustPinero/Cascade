import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { readIfExists } from "./file-utils";

/**
 * Build a system prompt for chatting about a specific project.
 * Loads the project's CLAUDE.md, handoff, debt, and relevant knowledge.
 */
export async function buildProjectSystemPrompt(
  prisma: PrismaClient,
  projectPath: string,
  projectName: string
): Promise<string> {
  const [claudeMdRaw, handoffRaw, debtRaw] = await Promise.all([
    readIfExists(path.join(projectPath, "CLAUDE.md")),
    readIfExists(path.join(projectPath, ".claude", "handoff.md")),
    readIfExists(path.join(projectPath, "audits", "debt.md")),
  ]);

  // Truncate to avoid exceeding context limits
  const claudeMd = claudeMdRaw?.slice(0, 3000) || "";
  const handoff = handoffRaw?.slice(0, 2000) || "";
  const debt = debtRaw?.slice(0, 1500) || "";

  // Get current request file
  let currentRequest = "";
  try {
    const requestsDir = path.join(projectPath, "requests");
    const phases = (await fs.readdir(requestsDir))
      .filter((p) => p.startsWith("phase-"))
      .sort();
    if (phases.length > 0) {
      const lastPhase = phases[phases.length - 1];
      const requests = (
        await fs.readdir(path.join(requestsDir, lastPhase))
      ).sort();
      if (requests.length > 0) {
        currentRequest = await fs.readFile(
          path.join(requestsDir, lastPhase, requests[requests.length - 1]),
          "utf-8"
        );
      }
    }
  } catch {
    // No requests
  }

  // Get relevant knowledge lessons
  const lessons = await prisma.knowledgeLesson.findMany({
    where: { severity: { in: ["critical", "important"] } },
    take: 10,
    select: { title: true, category: true, content: true },
  });

  const knowledgeBlock =
    lessons.length > 0
      ? `\n## Relevant Knowledge\n${lessons
          .map((l) => `- [${l.category}] ${l.title}: ${l.content.split("\n")[0]}`)
          .join("\n")}`
      : "";

  return `You are a senior engineering assistant working on the "${projectName}" project.
You have full context about this project's state, standards, and progress.
Help the developer with whatever they need: debugging, planning, code review, architecture decisions.

Be direct and specific. Reference actual files and patterns from the project.

## Project Configuration (CLAUDE.md)
${claudeMd || "_No CLAUDE.md found_"}

## Last Session Handoff
${handoff || "_No handoff file found_"}

## Technical Debt
${debt || "_No debt log found_"}

## Current Request
${currentRequest || "_No active request_"}
${knowledgeBlock}

## Guidelines
- Reference specific files and line numbers when possible
- If asked to make changes, describe exactly what to modify
- If asked to investigate, check the project's audits/ and .claude/ directories
- Keep responses focused and actionable`;
}
