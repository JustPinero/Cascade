/**
 * Phase 41.1 — Rig hygiene: stale scratch DB sweep.
 *
 * The rig's dispose() removes its own scratch DB, but crashed or
 * interrupted runs never reach dispose, so `test-rig-*.db` files
 * accumulate in prisma/ (568 were manually cleaned on 2026-07-07).
 * These tests pin the fix: rig startup sweeps scratch files that are
 * clearly older than the current run, while leaving the shared
 * template and any sibling worker's fresh scratch DBs alone.
 */
import { vi, describe, it, expect, afterEach } from "vitest";

// The rig introspects the test file's mocked child_process at runtime.
vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

import fs from "fs";
import path from "path";
import { createDispatchRig } from "./dispatch-rig";
import type { DispatchRig } from "./dispatch-rig.types";

const PRISMA_DIR = path.resolve(__dirname, "..", "..", "prisma");
const TEMPLATE_DB_PATH = path.join(PRISMA_DIR, "test-rig-template.db");

// Well past any reasonable grace window for "belongs to the current run".
const STALE_AGE_MS = 2 * 60 * 60 * 1000;

function createStaleFile(name: string): string {
  const filePath = path.join(PRISMA_DIR, name);
  fs.writeFileSync(filePath, "stale rig scratch");
  const past = new Date(Date.now() - STALE_AGE_MS);
  fs.utimesSync(filePath, past, past);
  return filePath;
}

let rig: DispatchRig | null = null;
const cleanupPaths: string[] = [];

afterEach(async () => {
  if (rig) {
    await rig.dispose();
    rig = null;
  }
  for (const filePath of cleanupPaths) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // already removed (that's the point of the sweep)
    }
  }
  cleanupPaths.length = 0;
  vi.clearAllMocks();
});

describe("dispatch rig — stale scratch DB sweep", () => {
  it("removes stale test-rig-*.db files and sidecars at rig startup", async () => {
    const staleDb = createStaleFile(`test-rig-stale-${process.pid}.db`);
    const staleJournal = createStaleFile(
      `test-rig-stale-${process.pid}.db-journal`
    );
    cleanupPaths.push(staleDb, staleJournal);

    rig = await createDispatchRig({ fakeTimers: false });

    expect(fs.existsSync(staleDb)).toBe(false);
    expect(fs.existsSync(staleJournal)).toBe(false);
  });

  it("leaves fresh scratch DBs, the template, and unrelated files alone", async () => {
    // Fresh scratch DB — simulates a sibling vitest worker's live rig.
    const freshDb = path.join(PRISMA_DIR, `test-rig-fresh-${process.pid}.db`);
    fs.writeFileSync(freshDb, "fresh rig scratch");
    cleanupPaths.push(freshDb);

    // Stale file that does NOT match the scratch pattern.
    const unrelated = createStaleFile(`not-a-rig-file-${process.pid}.db`);
    cleanupPaths.push(unrelated);

    rig = await createDispatchRig({ fakeTimers: false });

    expect(fs.existsSync(freshDb)).toBe(true);
    expect(fs.existsSync(unrelated)).toBe(true);
    // Template is created by vitest globalSetup and must never be swept.
    expect(fs.existsSync(TEMPLATE_DB_PATH)).toBe(true);
  });
});
