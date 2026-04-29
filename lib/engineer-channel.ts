import fs from "fs/promises";
import path from "path";

/**
 * Read the engineer channel content.
 * Tries engineer-channel.md first, falls back to kilroy-channel.md
 * for backwards compatibility.
 */
export async function readChannelContent(
  projectRoot: string
): Promise<string> {
  const engineerPath = path.join(
    projectRoot,
    ".claude",
    "engineer-channel.md"
  );
  const kilroyPath = path.join(
    projectRoot,
    ".claude",
    "kilroy-channel.md"
  );

  try {
    return await fs.readFile(engineerPath, "utf-8");
  } catch {
    // Fall back to legacy kilroy channel
    try {
      return await fs.readFile(kilroyPath, "utf-8");
    } catch {
      return "";
    }
  }
}

/**
 * Phase 19.2 — append a single message to the channel.
 *
 * Used by the Overseer chat route's writeback (so [ENGINEER] tags
 * Delamain emits get persisted) AND by the existing
 * /api/engineer-channel POST endpoint. Same backing file, same
 * format. Creates the file with a header on first write.
 */
export async function appendChannelMessage(
  projectRoot: string,
  from: "engineer" | "kilroy" | "overseer" | "delamain",
  message: string
): Promise<void> {
  const senderMap: Record<typeof from, string> = {
    engineer: "Engineer",
    kilroy: "Engineer",
    overseer: "Overseer",
    delamain: "Overseer",
  };
  const sender = senderMap[from];
  const timestamp = new Date().toISOString().split("T")[0];
  const entry = `\n**${sender}** (${timestamp}): ${message}\n`;

  const engineerPath = path.join(
    projectRoot,
    ".claude",
    "engineer-channel.md"
  );
  const kilroyPath = path.join(
    projectRoot,
    ".claude",
    "kilroy-channel.md"
  );

  // Prefer the new path. Fall back to the legacy file ONLY if it
  // already exists (don't recreate the legacy name).
  let target = engineerPath;
  try {
    await fs.access(engineerPath);
  } catch {
    try {
      await fs.access(kilroyPath);
      target = kilroyPath;
    } catch {
      // Neither exists — create the new one with a header.
      await fs.mkdir(path.dirname(engineerPath), { recursive: true });
      await fs.writeFile(
        engineerPath,
        "# Engineer ↔ Overseer Channel\n\n---\n"
      );
    }
  }

  await fs.appendFile(target, entry);
}
