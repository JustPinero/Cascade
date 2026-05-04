/**
 * Phase 23.6 — recorder tests.
 *
 * Hash function stability is the load-bearing contract: every
 * recording filename is the hash of the request body. If the hash
 * function silently changes, every existing recording rots.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { hashRequest, createRecorder } from "./recorder";
import type { AnthropicMessageResponse } from "@/lib/overseer-tools";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "evals-recorder-test-"));
}

describe("hashRequest", () => {
  it("returns the same string for identical input", () => {
    const body = { model: "claude-sonnet-4-6", system: "x", messages: [] };
    expect(hashRequest(body)).toBe(hashRequest(body));
  });

  it("returns different hashes when material input differs", () => {
    expect(
      hashRequest({ model: "claude-sonnet-4-6", system: "x" })
    ).not.toBe(hashRequest({ model: "claude-sonnet-4-6", system: "y" }));
  });

  it("ignores cache_control on tools", () => {
    const a = {
      tools: [
        { name: "t1", description: "a", input_schema: {} },
        { name: "t2", description: "b", input_schema: {} },
      ],
    };
    const b = {
      tools: [
        { name: "t1", description: "a", input_schema: {} },
        {
          name: "t2",
          description: "b",
          input_schema: {},
          cache_control: { type: "ephemeral" },
        },
      ],
    };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("ignores cache_control on system text blocks", () => {
    const a = { system: [{ type: "text", text: "hello" }] };
    const b = {
      system: [
        { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
      ],
    };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("ignores cache_control on message text blocks", () => {
    const a = {
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
    };
    const b = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "hi", cache_control: { type: "ephemeral" } },
          ],
        },
      ],
    };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("is stable across object key reordering", () => {
    const a = { model: "claude-sonnet-4-6", system: "x", max_tokens: 100 };
    const b = { max_tokens: 100, system: "x", model: "claude-sonnet-4-6" };
    expect(hashRequest(a)).toBe(hashRequest(b));
  });

  it("returns 16-char hex strings", () => {
    const h = hashRequest({ x: 1 });
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("createRecorder", () => {
  function fakeResponse(): AnthropicMessageResponse {
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    };
  }

  it("replay mode returns the recording when the hash matches", async () => {
    const dir = tmpDir();
    const params = { model: "claude-sonnet-4-6", system: "test", messages: [], tools: [] };
    const hash = hashRequest(params);
    const expected = fakeResponse();
    fs.writeFileSync(path.join(dir, `${hash}.json`), JSON.stringify(expected));

    const recorder = createRecorder({ mode: "replay", scenarioDir: dir });
    const result = await recorder(params as never);
    expect(result).toEqual(expected);
  });

  it("replay mode throws a clear error when no recording matches", async () => {
    const dir = tmpDir();
    const recorder = createRecorder({ mode: "replay", scenarioDir: dir });
    await expect(
      recorder({
        model: "claude-sonnet-4-6",
        system: "test",
        messages: [],
        tools: [],
      } as never)
    ).rejects.toThrow(/no recording at/);
  });

  it("record mode calls liveCaller and writes the response to disk", async () => {
    const dir = tmpDir();
    const expected = fakeResponse();
    const liveCaller = vi.fn(async () => expected);
    const recorder = createRecorder({
      mode: "record",
      scenarioDir: dir,
      liveCaller,
    });
    const params = {
      model: "claude-sonnet-4-6",
      system: "test",
      messages: [],
      tools: [],
    };
    const result = await recorder(params as never);
    expect(result).toEqual(expected);
    expect(liveCaller).toHaveBeenCalledTimes(1);
    const file = path.join(dir, `${hashRequest(params)}.json`);
    expect(fs.existsSync(file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual(expected);
  });

  it("record mode requires liveCaller", async () => {
    const dir = tmpDir();
    const recorder = createRecorder({ mode: "record", scenarioDir: dir });
    await expect(
      recorder({
        model: "claude-sonnet-4-6",
        system: "test",
        messages: [],
        tools: [],
      } as never)
    ).rejects.toThrow(/liveCaller/);
  });
});
