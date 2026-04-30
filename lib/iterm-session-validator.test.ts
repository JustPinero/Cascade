import { describe, it, expect, vi } from "vitest";
import {
  isITermSessionAlive,
  type OsascriptRunner,
} from "@/lib/iterm-session-validator";

const VALID_UUID = "0E252D6B-1234-5678-90AB-CDEF12345678";

describe("isITermSessionAlive", () => {
  it("returns true when osascript reports the session exists", async () => {
    const runner: OsascriptRunner = vi.fn().mockResolvedValueOnce("true\n");
    const result = await isITermSessionAlive(VALID_UUID, runner);
    expect(result).toBe(true);
  });

  it("returns false when osascript reports the session is missing", async () => {
    const runner: OsascriptRunner = vi.fn().mockResolvedValueOnce("false\n");
    expect(await isITermSessionAlive(VALID_UUID, runner)).toBe(false);
  });

  it("returns false on non-string input", async () => {
    const runner = vi.fn();
    // @ts-expect-error — exercising runtime defensive path
    expect(await isITermSessionAlive(undefined, runner)).toBe(false);
    // @ts-expect-error — exercising runtime defensive path
    expect(await isITermSessionAlive(null, runner)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns false on empty / whitespace input", async () => {
    const runner = vi.fn();
    expect(await isITermSessionAlive("", runner)).toBe(false);
    expect(await isITermSessionAlive("   ", runner)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns false on malformed UUID-ish input (no shell injection risk)", async () => {
    const runner = vi.fn();
    expect(await isITermSessionAlive('"; do bad things"', runner)).toBe(false);
    expect(await isITermSessionAlive("$(rm -rf /)", runner)).toBe(false);
    expect(await isITermSessionAlive("UUID with spaces", runner)).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("returns false when osascript throws (e.g. iTerm not running)", async () => {
    const runner: OsascriptRunner = vi
      .fn()
      .mockRejectedValueOnce(new Error("Command failed: osascript ..."));
    expect(await isITermSessionAlive(VALID_UUID, runner)).toBe(false);
  });

  it("returns false on unexpected runner output", async () => {
    const runner: OsascriptRunner = vi.fn().mockResolvedValueOnce("maybe\n");
    expect(await isITermSessionAlive(VALID_UUID, runner)).toBe(false);
  });

  it("trims whitespace from runner output before comparing", async () => {
    const runner: OsascriptRunner = vi
      .fn()
      .mockResolvedValueOnce("  true  \n\n");
    expect(await isITermSessionAlive(VALID_UUID, runner)).toBe(true);
  });
});
