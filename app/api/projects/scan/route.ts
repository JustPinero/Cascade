import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importProjects } from "@/lib/project-import";
import path from "path";
import os from "os";

function resolveProjectsDir(): string {
  const dir = process.env.PROJECTS_DIR || "~/Desktop/projects";
  if (dir.startsWith("~")) {
    return path.join(os.homedir(), dir.slice(1));
  }
  return path.resolve(dir);
}

export async function POST() {
  try {
    const projectsDir = resolveProjectsDir();
    const result = await importProjects(prisma, projectsDir);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during scan";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
