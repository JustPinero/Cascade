import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  generateSingleReport,
  generateCrossProjectReport,
  reportToMarkdown,
} from "@/lib/report-generator";

export async function POST(request: NextRequest) {
  try {
    const { type, slug } = await request.json();

    if (type === "single") {
      if (!slug) {
        return NextResponse.json(
          { error: "slug is required for single project report" },
          { status: 400 }
        );
      }

      const report = await generateSingleReport(prisma, slug);
      if (!report) {
        return NextResponse.json(
          { error: "Project not found" },
          { status: 404 }
        );
      }

      const markdown = reportToMarkdown(report);
      return NextResponse.json({ report, markdown });
    }

    if (type === "cross-project") {
      const report = await generateCrossProjectReport(prisma);
      const markdown = reportToMarkdown(report);
      return NextResponse.json({ report, markdown });
    }

    return NextResponse.json(
      { error: "Invalid type. Use 'single' or 'cross-project'" },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
