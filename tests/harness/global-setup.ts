/**
 * Phase 23.7 — Vitest globalSetup.
 *
 * Pushes the Prisma schema to a single template SQLite DB once per
 * test run. Per-rig DBs (created by createDispatchRig) copy this
 * template instead of running `prisma db push` themselves.
 *
 * Why this exists: parallel vitest workers were racing on the
 * Prisma client regeneration that `prisma db push` triggers (writes
 * to app/generated/prisma/). Concurrent generates corrupted each
 * other and produced flaky test failures across rig-using files.
 * Pushing once globally and copying the resulting file is fast,
 * deterministic, and worker-safe.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CASCADE_ROOT = path.resolve(__dirname, "..", "..");
const PRISMA_DIR = path.join(CASCADE_ROOT, "prisma");
const TEMPLATE_DB_PATH = path.join(PRISMA_DIR, "test-rig-template.db");

export const TEMPLATE_DB_PATH_EXPORT = TEMPLATE_DB_PATH;

export async function setup() {
  // Wipe stale template so schema is always fresh.
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${TEMPLATE_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  execSync("pnpm exec prisma db push", {
    cwd: CASCADE_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: `file:${TEMPLATE_DB_PATH}`,
    },
  });
}

export async function teardown() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = `${TEMPLATE_DB_PATH}${suffix}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
    }
  }
}
