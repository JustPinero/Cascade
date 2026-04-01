import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";

describe("project scaffold", () => {
  it("has a valid tsconfig.json", async () => {
    const tsconfig = await import("@/tsconfig.json");
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("has Prisma schema", () => {
    const schemaPath = resolve(__dirname, "../prisma/schema.prisma");
    expect(existsSync(schemaPath)).toBe(true);
  });

  it("has required config files", () => {
    const root = resolve(__dirname, "..");
    const requiredFiles = [
      "next.config.ts",
      "vitest.config.ts",
      "playwright.config.ts",
      "prisma.config.ts",
      "CLAUDE.md",
    ];
    for (const file of requiredFiles) {
      expect(existsSync(resolve(root, file))).toBe(true);
    }
  });
});
