import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { reconcileFleet } from "@/lib/fleet-reconciler";

/**
 * GET /api/reconciliation (phase 41.4)
 *
 * The fleet dashboard's drift surface: runs the fleet reconciler over
 * every Project row and returns a findings count plus the drifted
 * projects. Fetch is disabled — this is a fast, local-only pass suitable
 * for dashboard loads (comparisons use last-known remote refs); the
 * morning briefing runs the fetch-enabled pass.
 */
export async function GET() {
  try {
    const rows = await prisma.project.findMany({
      select: { slug: true, name: true, path: true, status: true },
    });

    const fleet = await reconcileFleet(
      rows.map((p) => ({
        slug: p.slug,
        name: p.name,
        path: p.path,
        status: p.status,
      })),
      { fetch: false }
    );

    return NextResponse.json({
      generatedAt: fleet.generatedAt,
      findingsCount: fleet.findingsCount,
      projects: fleet.drifted.map((p) => ({
        slug: p.slug,
        name: p.name,
        findings: p.findings.map((f) => ({
          type: f.type,
          severity: f.severity,
          message: f.message,
        })),
        remote: p.remote,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
