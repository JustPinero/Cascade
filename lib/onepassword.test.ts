import { describe, it, expect } from "vitest";
import { readExpectedVars } from "./onepassword";
import fs from "fs/promises";
import path from "path";

const TEST_DIR = path.resolve(__dirname, "../.test-op");

describe("onepassword", () => {
  describe("readExpectedVars", () => {
    it("reads env vars from .env.example", async () => {
      await fs.mkdir(TEST_DIR, { recursive: true });
      await fs.writeFile(
        path.join(TEST_DIR, ".env.example"),
        `# Database
DATABASE_URL=postgresql://localhost
ANTHROPIC_API_KEY=sk-ant-xxx

# Optional
# VERCEL_TOKEN=xxx
`
      );

      const vars = await readExpectedVars(TEST_DIR);
      expect(vars).toContain("DATABASE_URL");
      expect(vars).toContain("ANTHROPIC_API_KEY");
      expect(vars).not.toContain("VERCEL_TOKEN"); // commented out
    });

    it("returns empty array for missing file", async () => {
      const vars = await readExpectedVars("/nonexistent");
      expect(vars).toEqual([]);
    });

    afterAll(async () => {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    });
  });
});
