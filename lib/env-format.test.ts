import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

describe(".env.example format", () => {
  it("uses an op:// reference for ANTHROPIC_API_KEY", () => {
    const content = readRepoFile(".env.example");
    const line = content
      .split("\n")
      .find((l) => l.startsWith("ANTHROPIC_API_KEY"));
    expect(line).toBeDefined();
    expect(line!).toMatch(/^ANTHROPIC_API_KEY=op:\/\//);
  });

  it("does not include any plaintext API-key placeholders", () => {
    const content = readRepoFile(".env.example");
    expect(content).not.toMatch(/your-api-key-here/);
    expect(content).not.toMatch(/sk-ant-xxx/);
  });

  it("keeps DATABASE_URL as a literal (not an op:// reference)", () => {
    const content = readRepoFile(".env.example");
    const line = content.split("\n").find((l) => l.startsWith("DATABASE_URL"));
    expect(line).toBeDefined();
    expect(line!).not.toMatch(/op:\/\//);
  });
});

describe("package.json scripts wrap with op run", () => {
  it("dev script wraps with op run --env-file=.env", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.dev).toMatch(/op run --env-file=\.env/);
  });

  it("start script wraps with op run --env-file=.env", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.start).toMatch(/op run --env-file=\.env/);
  });
});

describe("legacy populate-vault.sh removal", () => {
  it("is deleted — 1P is source of truth now, not backup", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, "scripts", "populate-vault.sh"))
    ).toBe(false);
  });
});
