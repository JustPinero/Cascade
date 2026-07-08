/**
 * Phase 41.5 — canonical Stop-hook script (spool-on-failure).
 *
 * The shipped Stop hook is bash and runs in every managed project's
 * session. Phase 41.5 moves the fire-and-forget curl into a canonical
 * script (`scripts/session-complete-hook.sh`) that spools the payload
 * to a JSONL file when Cascade's server is unreachable, so no Stop-hook
 * ping is lost while the dev server is down (or `op` is signed out).
 *
 * These tests execute the real script with bash against a scratch spool
 * path — a dead port (spool lands) and a live listener (no spool).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import type { AddressInfo } from "net";

const execFileAsync = promisify(execFile);

const SCRIPT = path.resolve(__dirname, "session-complete-hook.sh");

let tmpDir: string;
let spoolPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-hook-"));
  spoolPath = path.join(tmpDir, "webhook-spool.jsonl");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Async exec: the "server up" test runs an in-process HTTP listener on
// the same event loop, so a synchronous exec would deadlock (the server
// can't respond while the main thread blocks on the child).
async function runHook(
  args: string[],
  env: Record<string, string> = {}
): Promise<void> {
  await execFileAsync("bash", [SCRIPT, ...args], {
    env: { ...process.env, CASCADE_WEBHOOK_SPOOL: spoolPath, ...env },
  });
}

/** Bind an ephemeral port, capture it, then close — guarantees a
 * closed (connection-refused) port for the "server down" tests. */
async function findClosedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe("session-complete-hook.sh — spool on failure", () => {
  it("spools the payload when the server is unreachable", async () => {
    const deadPort = await findClosedPort();
    await runHook(["/p/alpha", String(deadPort)]);

    expect(fs.existsSync(spoolPath)).toBe(true);
    const lines = fs
      .readFileSync(spoolPath, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]) as { projectPath: string };
    expect(payload.projectPath).toBe("/p/alpha");
  });

  it("includes idempotencyKey in the spooled payload when CASCADE_DISPATCH_ID is set", async () => {
    const deadPort = await findClosedPort();
    await runHook(["/p/beta", String(deadPort)], {
      CASCADE_DISPATCH_ID: "disp-123",
    });

    const payload = JSON.parse(
      fs.readFileSync(spoolPath, "utf-8").trim()
    ) as { projectPath: string; idempotencyKey: string };
    expect(payload.projectPath).toBe("/p/beta");
    expect(payload.idempotencyKey).toBe("disp-123");
  });
});

describe("session-complete-hook.sh — posts normally when server is up", () => {
  it("POSTs the payload and does NOT spool when the server responds", async () => {
    const received: Array<{ projectPath: string }> = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    // Listen on all interfaces so curl's `localhost` reaches it on
    // either IPv4 (127.0.0.1) or IPv6 (::1) — macOS resolves localhost
    // to ::1 first.
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as AddressInfo).port;

    try {
      await runHook(["/p/gamma", String(port)]);
      expect(received).toHaveLength(1);
      expect(received[0].projectPath).toBe("/p/gamma");
      // No spool entry — the POST succeeded.
      expect(fs.existsSync(spoolPath)).toBe(false);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
