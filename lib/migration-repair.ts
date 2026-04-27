import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { resolveProjectsDir, isInsideProjectsDir } from "./validators";

export type RepairAction = "clone" | "archive" | "delete" | "skip";

export interface OrphanCandidates {
  githubRemote: string | null;
  suggestedLocalPath: string;
  onDiskNow: boolean;
}

export interface Orphan {
  id: number;
  name: string;
  slug: string;
  oldPath: string;
  status: string;
  candidates: OrphanCandidates;
}

export interface RepairResult {
  action: RepairAction;
  projectId: number;
  message: string;
  dryRun?: boolean;
}

export interface ScanOpts {
  projectsDir?: string;
  ghLookup?: (owner: string) => Array<{ name: string; sshUrl: string }> | null;
}

export interface ApplyOpts {
  projectsDir?: string;
  dryRun?: boolean;
  cascadeSelfSlug?: string;
  execFn?: (cmd: string, opts: object) => void;
  remote?: string;
}

type GhRepo = Array<{ name: string; sshUrl: string }>;

function defaultGhLookup(owner: string): GhRepo | null {
  try {
    const out = execSync(
      `gh repo list ${owner} --json name,sshUrl --limit 200`,
      { stdio: "pipe" }
    ).toString();
    return JSON.parse(out) as GhRepo;
  } catch {
    return null;
  }
}

export async function scanForOrphans(
  prisma: PrismaClient,
  opts?: ScanOpts
): Promise<Orphan[]> {
  const projectsDir = opts?.projectsDir ?? resolveProjectsDir();
  const ghLookup = opts?.ghLookup ?? defaultGhLookup;

  const owner = process.env.GITHUB_OWNER ?? "";

  // Cache the gh lookup for the whole run
  let repoList: GhRepo | null = null;
  let lookupAttempted = false;

  const projects = await prisma.project.findMany();
  const orphans: Orphan[] = [];

  for (const p of projects) {
    if (fs.existsSync(p.path)) continue;

    const suggestedLocalPath = path.join(projectsDir, p.slug);
    const onDiskNow = fs.existsSync(suggestedLocalPath);

    if (!lookupAttempted) {
      lookupAttempted = true;
      if (owner) {
        repoList = ghLookup(owner);
      } else {
        repoList = ghLookup("");
      }
    }

    let githubRemote: string | null = null;
    if (repoList) {
      const match = repoList.find(
        (r) => r.name.toLowerCase() === p.slug.toLowerCase()
      );
      if (match) {
        githubRemote = match.sshUrl;
      }
    }

    orphans.push({
      id: p.id,
      name: p.name,
      slug: p.slug,
      oldPath: p.path,
      status: p.status,
      candidates: { githubRemote, suggestedLocalPath, onDiskNow },
    });
  }

  return orphans;
}

export function recommend(orphan: Orphan): RepairAction {
  const { githubRemote } = orphan.candidates;

  if (githubRemote) return "clone";
  if (orphan.status === "complete") return "archive";
  if (orphan.status === "archived") return "delete";
  return "skip";
}

export async function applyRepair(
  prisma: PrismaClient,
  id: number,
  action: RepairAction,
  opts?: ApplyOpts
): Promise<RepairResult> {
  const projectsDir = opts?.projectsDir ?? resolveProjectsDir();
  const dryRun = opts?.dryRun ?? false;
  const cascadeSelfSlug = opts?.cascadeSelfSlug ?? process.env.CASCADE_SELF_SLUG ?? "cascade";
  const execFn = opts?.execFn ?? ((cmd: string, o: object) => execSync(cmd, o));

  const project = await prisma.project.findUniqueOrThrow({ where: { id } });

  if (action === "delete" && project.slug === cascadeSelfSlug) {
    throw new Error(
      `Cannot delete project "${cascadeSelfSlug}" — this is the running Cascade instance`
    );
  }

  if (dryRun) {
    return { action, projectId: id, message: `[dry-run] would ${action} "${project.name}"`, dryRun: true };
  }

  if (action === "clone") {
    const targetPath = path.join(projectsDir, project.slug);

    if (!isInsideProjectsDir(targetPath, projectsDir)) {
      throw new Error(
        `Invalid path: "${targetPath}" is outside projects dir "${projectsDir}"`
      );
    }

    // If the repo already landed at the suggested path, just update the DB row
    if (!fs.existsSync(targetPath)) {
      const remote =
        opts?.remote ?? (await resolveRemoteForClone(project));
      if (!remote) {
        throw new Error(
          `Cannot clone "${project.slug}" — no GitHub remote found. Use archive or skip instead.`
        );
      }
      execFn(`git clone ${remote} "${targetPath}"`, { stdio: "pipe" });
    }

    await prisma.project.update({
      where: { id },
      data: { path: targetPath, lastActivityAt: new Date() },
    });

    return { action, projectId: id, message: `Cloned "${project.name}" to ${targetPath}` };
  }

  if (action === "archive") {
    await prisma.project.update({
      where: { id },
      data: { status: "archived", currentRequest: null, lastActivityAt: new Date() },
    });
    return { action, projectId: id, message: `Archived "${project.name}"` };
  }

  if (action === "delete") {
    await prisma.project.delete({ where: { id } });
    return { action, projectId: id, message: `Deleted "${project.name}" from DB` };
  }

  // skip
  return { action: "skip", projectId: id, message: `Skipped "${project.name}"` };
}

async function resolveRemoteForClone(project: {
  slug: string;
  githubRepo: string | null;
}): Promise<string | null> {
  if (project.githubRepo) {
    return `git@github.com:${project.githubRepo}.git`;
  }
  const owner = process.env.GITHUB_OWNER ?? "";
  if (!owner) return null;
  return `git@github.com:${owner}/${project.slug}.git`;
}
