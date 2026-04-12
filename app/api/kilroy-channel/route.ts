import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const CHANNEL_PATH = path.resolve(
  process.cwd(),
  ".claude",
  "kilroy-channel.md"
);

/**
 * GET /api/kilroy-channel
 *
 * Read the current channel contents.
 */
export async function GET() {
  try {
    const content = await fs.readFile(CHANNEL_PATH, "utf-8");
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

/**
 * POST /api/kilroy-channel
 *
 * Append a message to the channel.
 * Body: { from: "kilroy" | "delamain", message: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { from, message } = await request.json();

    if (!from || !message) {
      return NextResponse.json(
        { error: "from and message are required" },
        { status: 400 }
      );
    }

    const timestamp = new Date().toISOString().split("T")[0];
    const sender = from === "delamain" ? "Del" : "Kilroy";
    const entry = `\n**${sender}** (${timestamp}): ${message}\n`;

    // Append to channel file
    try {
      await fs.access(CHANNEL_PATH);
    } catch {
      // Create the file if it doesn't exist
      await fs.mkdir(path.dirname(CHANNEL_PATH), { recursive: true });
      await fs.writeFile(
        CHANNEL_PATH,
        "# Kilroy ↔ Delamain Channel\n\n---\n"
      );
    }

    await fs.appendFile(CHANNEL_PATH, entry);

    return NextResponse.json({ ok: true, sender, timestamp });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
