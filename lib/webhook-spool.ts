/**
 * Phase 41.5 — server-side spool drain.
 *
 * The canonical Stop-hook script (scripts/session-complete-hook.sh)
 * appends a JSON line to the spool file when Cascade's webhook is
 * unreachable. This module reads that spool on server boot and on an
 * interval and replays each entry through the SAME ingestion path as a
 * live POST (`lib/webhook-ingest.ts#ingestSessionComplete`), then
 * removes what it processed.
 *
 * Atomicity vs concurrent writes: a Stop hook may append to the spool
 * at any moment, including mid-drain. The drain RENAMES the spool aside
 * before reading it — rename is atomic on POSIX, and the hook's `>>`
 * recreates a fresh spool for any append that lands after the rename.
 * So a concurrent append is never lost and never double-ingested.
 *
 * Malformed lines are quarantined (appended to `<spool>.quarantine`)
 * and logged, never fatal. Ingestion is idempotent — the dispatcher
 * dedups on idempotencyKey, so replaying the same entry twice yields a
 * single outcome.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import {
  ingestSessionComplete,
  type IngestInput,
} from "@/lib/webhook-ingest";

/**
 * Resolve the spool file path. Env-configurable and defaults OUTSIDE
 * any repo (~/.cascade/) so a spool never gets committed or wiped by a
 * project checkout. Mirrors the default in session-complete-hook.sh.
 */
export function resolveSpoolPath(): string {
  return (
    process.env.CASCADE_WEBHOOK_SPOOL ||
    path.join(os.homedir(), ".cascade", "webhook-spool.jsonl")
  );
}

export interface DrainResult {
  /** Entries successfully replayed through the ingestion path. */
  ingested: number;
  /** Entries skipped (malformed, invalid shape, or re-spooled on error). */
  skipped: number;
}

type IngestFn = (
  prisma: PrismaClient,
  input: IngestInput
) => Promise<unknown>;

export interface DrainOptions {
  /** Override the spool path (tests / non-default deployments). */
  spoolPath?: string;
  /** Override the ingestion function (test injection). */
  ingest?: IngestFn;
  /** Structured logger for skipped/failed lines (defaults to console). */
  logger?: (event: Record<string, unknown>) => void;
}

interface SpoolPayload {
  projectPath?: unknown;
  idempotencyKey?: unknown;
}

/**
 * Drain the webhook spool. Returns counts of ingested vs skipped
 * entries. Never throws — spool drain is best-effort background work
 * and must not crash the server boot or the interval tick.
 */
export async function drainWebhookSpool(
  prisma: PrismaClient,
  opts: DrainOptions = {}
): Promise<DrainResult> {
  const spoolPath = opts.spoolPath ?? resolveSpoolPath();
  const ingest = opts.ingest ?? ingestSessionComplete;
  const log =
    opts.logger ?? ((e: Record<string, unknown>) => console.error(JSON.stringify(e)));
  const quarantinePath = `${spoolPath}.quarantine`;

  // Nothing to do if the spool doesn't exist yet.
  if (!fs.existsSync(spoolPath)) return { ingested: 0, skipped: 0 };

  // Atomic rotation — claim the current spool contents by renaming it
  // aside. Concurrent Stop-hook appends recreate a fresh spool via
  // `>>`, so they can't be lost or swept into this batch. A failed
  // rename means a parallel drain already claimed it: nothing to do.
  const rotated = `${spoolPath}.draining-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(spoolPath, rotated);
  } catch {
    return { ingested: 0, skipped: 0 };
  }

  let content: string;
  try {
    content = fs.readFileSync(rotated, "utf-8");
  } catch (err) {
    log({
      event: "webhook_spool_read_failed",
      error: err instanceof Error ? err.message : String(err),
    });
    return { ingested: 0, skipped: 0 };
  }

  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  let ingested = 0;
  let skipped = 0;

  for (const line of lines) {
    let parsed: SpoolPayload;
    try {
      parsed = JSON.parse(line) as SpoolPayload;
    } catch {
      // Corrupt line — quarantine, log, keep going.
      skipped++;
      quarantine(quarantinePath, line);
      log({ event: "webhook_spool_malformed_line", line: line.slice(0, 120) });
      continue;
    }

    if (!parsed || typeof parsed.projectPath !== "string") {
      // Valid JSON but wrong shape — treat like a malformed line.
      skipped++;
      quarantine(quarantinePath, line);
      log({
        event: "webhook_spool_invalid_payload",
        line: line.slice(0, 120),
      });
      continue;
    }

    const input: IngestInput = {
      projectPath: parsed.projectPath,
      idempotencyKey:
        typeof parsed.idempotencyKey === "string"
          ? parsed.idempotencyKey
          : undefined,
    };

    try {
      await ingest(prisma, input);
      ingested++;
    } catch (err) {
      // Ingestion failed (transient server-side error) — re-spool the
      // entry so a later drain retries it rather than dropping it.
      skipped++;
      try {
        fs.appendFileSync(spoolPath, line + "\n");
      } catch {
        // best-effort
      }
      log({
        event: "webhook_spool_ingest_failed",
        projectPath: input.projectPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Batch done — drop the rotated file. Any concurrent append lives in
  // the fresh spool, untouched.
  try {
    fs.unlinkSync(rotated);
  } catch {
    // best-effort
  }

  return { ingested, skipped };
}

function quarantine(quarantinePath: string, line: string): void {
  try {
    fs.appendFileSync(quarantinePath, line + "\n");
  } catch {
    // best-effort — a quarantine write failure must not stop the drain
  }
}
