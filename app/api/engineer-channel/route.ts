import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const CHANNEL_PATH = path.resolve(
  process.cwd(),
  ".claude",
  "engineer-channel.md"
);

const LEGACY_PATH = path.resolve(
  process.cwd(),
  ".claude",
  "kilroy-channel.md"
);

/**
 * Get the active channel file path (engineer-channel.md or legacy kilroy-channel.md).
 */
async function getChannelPath(): Promise<string> {
  try {
    await fs.access(CHANNEL_PATH);
    return CHANNEL_PATH;
  } catch {
    try {
      await fs.access(LEGACY_PATH);
      return LEGACY_PATH;
    } catch {
      return CHANNEL_PATH; // Default to new name for creation
    }
  }
}

/**
 * GET /api/engineer-channel
 *
 * Read the current channel contents.
 */
export async function GET() {
  try {
    const channelPath = await getChannelPath();
    const content = await fs.readFile(channelPath, "utf-8");
    return NextResponse.json({ content });
  } catch {
    return NextResponse.json({ content: "" });
  }
}

/**
 * POST /api/engineer-channel
 *
 * Append a message to the channel.
 * Body: { from: "engineer" | "overseer" | "kilroy" | "delamain", message: string }
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
    const senderMap: Record<string, string> = {
      engineer: "Engineer",
      kilroy: "Engineer",
      overseer: "Overseer",
      delamain: "Overseer",
    };
    const sender = senderMap[from] || from;
    const entry = `\n**${sender}** (${timestamp}): ${message}\n`;

    const channelPath = await getChannelPath();

    // Create the file if it doesn't exist
    try {
      await fs.access(channelPath);
    } catch {
      await fs.mkdir(path.dirname(channelPath), { recursive: true });
      await fs.writeFile(
        channelPath,
        "# Engineer ↔ Overseer Channel\n\n---\n"
      );
    }

    await fs.appendFile(channelPath, entry);

    return NextResponse.json({ ok: true, sender, timestamp });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
