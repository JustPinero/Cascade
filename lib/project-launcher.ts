import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { PrismaClient } from "@/app/generated/prisma/client";
import { createGitHubRepo } from "./github";

export interface LaunchConfig {
  name: string;
  slug: string;
  projectType: string;
  kickoffContent: string;
  createGithubRepo: boolean;
  isPrivate: boolean;
  autonomyMode: string;
  agentTeamsEnabled: boolean;
  prWorkflowEnabled: boolean;
}

export interface LaunchResult {
  success: boolean;
  projectPath: string;
  githubUrl: string | null;
  error: string | null;
}

/**
 * Launch a new project: create directory, write kickoff, init git,
 * optionally create GitHub repo, register in DB.
 */
export async function launchProject(
  prisma: PrismaClient,
  projectsDir: string,
  config: LaunchConfig
): Promise<LaunchResult> {
  const projectPath = path.join(projectsDir, config.name);

  try {
    // 1. Create project directory
    await fs.mkdir(projectPath, { recursive: true });

    // 2. Write kickoff prompt
    await fs.writeFile(
      path.join(projectPath, "KICKOFF.md"),
      config.kickoffContent,
      "utf-8"
    );

    // 3. Initialize git
    execSync("git init", { cwd: projectPath, stdio: "pipe" });
    execSync("git add -A", { cwd: projectPath, stdio: "pipe" });
    execSync('git commit -m "Initial commit: project kickoff"', {
      cwd: projectPath,
      stdio: "pipe",
    });

    // 4. Optionally create GitHub repo
    let githubUrl: string | null = null;
    if (config.createGithubRepo) {
      const repoResult = createGitHubRepo({
        name: config.slug,
        isPrivate: config.isPrivate,
        description: `${config.name} — created by Cascade`,
      });

      if (repoResult.success) {
        githubUrl = repoResult.url;
        // Add remote and push
        try {
          execSync(`git remote add origin ${githubUrl}`, {
            cwd: projectPath,
            stdio: "pipe",
          });
        } catch {
          // Remote may already exist
        }
      }
    }

    // 5. Register in database
    await prisma.project.create({
      data: {
        name: config.name,
        slug: config.slug,
        path: projectPath,
        status: "building",
        health: "idle",
        currentPhase: "phase-1-foundation",
        autonomyMode: config.autonomyMode,
        agentTeamsEnabled: config.agentTeamsEnabled,
        prWorkflowEnabled: config.prWorkflowEnabled,
        githubRepo: githubUrl,
        stack: JSON.stringify({ projectType: config.projectType }),
      },
    });

    // 6. Log activity
    const project = await prisma.project.findUnique({
      where: { slug: config.slug },
    });
    if (project) {
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "project-created",
          summary: `Created project: ${config.name}`,
        },
      });
    }

    return {
      success: true,
      projectPath,
      githubUrl,
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error launching project";
    return {
      success: false,
      projectPath,
      githubUrl: null,
      error: message,
    };
  }
}
