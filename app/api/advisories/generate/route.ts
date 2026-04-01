import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateAdvisories } from "@/lib/advisory-engine";

export async function POST() {
  try {
    const result = await generateAdvisories(prisma);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
