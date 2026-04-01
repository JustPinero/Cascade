import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const PLAYBOOK_PATH = path.resolve(
  process.cwd(),
  "knowledge",
  "overseer-playbook.md"
);

export async function GET() {
  try {
    const content = await fs.readFile(PLAYBOOK_PATH, "utf-8");
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { content } = await request.json();

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 }
      );
    }

    await fs.writeFile(PLAYBOOK_PATH, content, "utf-8");
    return NextResponse.json({ success: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
