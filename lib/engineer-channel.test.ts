import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs/promises";
import path from "path";
import { readChannelContent } from "./engineer-channel";

const TEST_DIR = path.resolve(__dirname, "../.test-engineer-channel");

beforeAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(TEST_DIR, ".claude"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(TEST_DIR, { recursive: true, force: true });
});

describe("readChannelContent", () => {
  it("reads from engineer-channel.md when it exists", async () => {
    await fs.writeFile(
      path.join(TEST_DIR, ".claude", "engineer-channel.md"),
      "# Engineer Channel\nTest message"
    );
    const content = await readChannelContent(TEST_DIR);
    expect(content).toContain("Test message");
  });

  it("falls back to kilroy-channel.md when engineer file missing", async () => {
    const dir = path.join(TEST_DIR, "fallback");
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".claude", "kilroy-channel.md"),
      "# Kilroy Channel\nLegacy message"
    );
    const content = await readChannelContent(dir);
    expect(content).toContain("Legacy message");
  });

  it("returns empty string when neither file exists", async () => {
    const dir = path.join(TEST_DIR, "empty");
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    const content = await readChannelContent(dir);
    expect(content).toBe("");
  });
});
