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
