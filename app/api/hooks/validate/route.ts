import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";

interface HookRepairResult {
  project: string;
  slug: string;
  status: "ok" | "repaired" | "no-settings" | "error";
  repairsCount: number;
  error?: string;
}

/**
 * POST /api/hooks/validate
 *
 * Scans all projects' .claude/settings.json files and repairs
 * malformed hook entries (old flat format → nested format).
 */
export async function POST() {
  try {
    const projects = await prisma.project.findMany();
    const results: HookRepairResult[] = [];

    for (const project of projects) {
      const settingsPath = path.join(
        project.path,
        ".claude",
        "settings.json"
      );

      if (!fs.existsSync(settingsPath)) {
        results.push({
          project: project.name,
          slug: project.slug,
          status: "no-settings",
          repairsCount: 0,
        });
        continue;
      }

      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const settings = JSON.parse(raw);

        if (!settings.hooks) {
          results.push({
            project: project.name,
            slug: project.slug,
            status: "ok",
            repairsCount: 0,
          });
          continue;
        }

        let repairsCount = 0;
        const fixedHooks: Record<string, unknown[]> = {};

        for (const [event, entries] of Object.entries(settings.hooks)) {
          if (!Array.isArray(entries)) continue;
          fixedHooks[event] = [];

          for (const entry of entries) {
            const e = entry as Record<string, unknown>;
            if (e.type && e.command && !e.hooks) {
              fixedHooks[event].push({
                matcher: (e.matcher as string) || "",
                hooks: [
                  {
                    type: e.type,
                    command: e.command,
                    description: e.description || undefined,
                  },
                ],
              });
              repairsCount++;
            } else {
              fixedHooks[event].push(entry);
            }
          }
        }

        if (repairsCount > 0) {
          settings.hooks = fixedHooks;
          fs.writeFileSync(
            settingsPath,
            JSON.stringify(settings, null, 2) + "\n"
          );
          results.push({
            project: project.name,
            slug: project.slug,
            status: "repaired",
            repairsCount,
          });
        } else {
          results.push({
            project: project.name,
            slug: project.slug,
            status: "ok",
            repairsCount: 0,
          });
        }
      } catch (err) {
        results.push({
          project: project.name,
          slug: project.slug,
          status: "error",
          repairsCount: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalRepairs = results.reduce((s, r) => s + r.repairsCount, 0);
    const repairedProjects = results.filter(
      (r) => r.status === "repaired"
    ).length;

    return NextResponse.json({
      totalRepairs,
      repairedProjects,
      totalProjects: results.length,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
