import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CASCADE_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Push the Prisma schema to a test database. Cross-platform: passes
 * DATABASE_URL via env option instead of an inline shell prefix (which
 * doesn't parse on Windows cmd).
 */
export function pushTestSchema(dbUrl: string, cwd: string = CASCADE_ROOT): void {
  execSync("pnpm exec prisma db push", {
    cwd,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
}

/**
 * Initialize a git repo with a baseline commit. Sets user.name and
 * user.email locally so `git commit` succeeds even when the host has
 * no global git identity (common on fresh Windows installs).
 */
export function gitInitWithAuthor(
  dir: string,
  initialContent?: { file: string; contents: string }
): void {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Cascade Test"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@cascade.local"', {
    cwd: dir,
    stdio: "pipe",
  });
  if (initialContent) {
    const filePath = path.join(dir, initialContent.file);
    fs.writeFileSync(filePath, initialContent.contents);
  }
  execSync("git add -A", { cwd: dir, stdio: "pipe" });
  execSync('git commit --allow-empty -m "init"', {
    cwd: dir,
    stdio: "pipe",
  });
}
