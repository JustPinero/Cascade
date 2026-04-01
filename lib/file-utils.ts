import fs from "fs/promises";

/**
 * Read a file if it exists, return empty string if not.
 * Shared utility to avoid duplication across lib/ modules.
 */
export async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}
