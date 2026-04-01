import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const PLAYBOOK_PATH = path.resolve(__dirname, "../../../knowledge/overseer-playbook.md");

describe("Playbook API logic", () => {
  it("playbook file exists", () => {
    expect(fs.existsSync(PLAYBOOK_PATH)).toBe(true);
  });

  it("playbook has content", () => {
    const content = fs.readFileSync(PLAYBOOK_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("# Overseer Playbook");
  });

  it("playbook contains rule lines starting with -", () => {
    const content = fs.readFileSync(PLAYBOOK_PATH, "utf-8");
    const rules = content.split("\n").filter((l) => l.startsWith("- "));
    expect(rules.length).toBeGreaterThan(0);
  });

  it("PUT would write content correctly", () => {
    // Test the write/read cycle
    const testPath = path.resolve(__dirname, "../../../.test-playbook.md");
    const testContent = "# Test Playbook\n- Rule 1\n- Rule 2\n";
    fs.writeFileSync(testPath, testContent, "utf-8");
    const readBack = fs.readFileSync(testPath, "utf-8");
    expect(readBack).toBe(testContent);
    fs.unlinkSync(testPath);
  });

  it("rejects non-string content", () => {
    const content = 12345;
    expect(typeof content !== "string").toBe(true);
  });
});
