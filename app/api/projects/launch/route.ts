import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { launchProject } from "@/lib/project-launcher";
import path from "path";
import os from "os";

function resolveProjectsDir(): string {
  const dir = process.env.PROJECTS_DIR || "~/Desktop/projects";
  if (dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return path.resolve(dir);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      slug,
      projectType,
      kickoffContent,
      createGithubRepo,
      isPrivate,
      autonomyMode,
      agentTeamsEnabled,
      prWorkflowEnabled,
    } = body;

    if (!name || !slug || !kickoffContent) {
      return NextResponse.json(
        { error: "name, slug, and kickoffContent are required" },
        { status: 400 }
      );
    }

    const projectsDir = resolveProjectsDir();

    const result = await launchProject(prisma, projectsDir, {
      name,
      slug,
      projectType: projectType || "web-app",
      kickoffContent,
      createGithubRepo: createGithubRepo || false,
      isPrivate: isPrivate ?? true,
      autonomyMode: autonomyMode || "semi",
      agentTeamsEnabled: agentTeamsEnabled || false,
      prWorkflowEnabled: prWorkflowEnabled || false,
    });

    if (result.success) {
      return NextResponse.json(result, { status: 201 });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
