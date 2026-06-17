import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  computeRecommendations,
  type ProjectOutcomes,
} from "@/lib/dispatch-recommendations";

/**
 * Phase 40 [P3] — outcome-driven dispatch recommendations for the dashboard.
 *
 * Reads recent DispatchOutcome rows across the fleet, groups them by project,
 * and runs the pure recommendation engine. The engine — not this route —
 * owns the heuristics, so the dashboard and the Overseer agree on the data.
 *
 * No-store: the widget polls and must see fresh state after sessions land.
 */

const WINDOW_DAYS = 14;

function parseSignals(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const rows = await prisma.dispatchOutcome.findMany({
    where: { completedAt: { gte: since } },
    select: { projectSlug: true, mode: true, outcome: true, signals: true },
    orderBy: { completedAt: "desc" },
  });

  const byProject = new Map<string, ProjectOutcomes>();
  for (const row of rows) {
    let project = byProject.get(row.projectSlug);
    if (!project) {
      project = { slug: row.projectSlug, outcomes: [] };
      byProject.set(row.projectSlug, project);
    }
    project.outcomes.push({
      mode: row.mode,
      outcome: row.outcome,
      signals: parseSignals(row.signals),
    });
  }

  const recommendations = computeRecommendations(Array.from(byProject.values()));

  return NextResponse.json(
    { recommendations },
    { headers: { "Cache-Control": "no-store" } }
  );
}
