/**
 * Phase 23.6 — request-body hash + replay/record interceptor.
 *
 * Hash function spec (pinned, do not silently mutate):
 *   1. Deep-clone the input body so caller objects aren't mutated.
 *   2. Walk the tree and delete every `cache_control` key recursively.
 *      Cache markers are a transport concern; the model output doesn't
 *      depend on them, so two requests differing only in cache_control
 *      must hash identically.
 *   3. Stringify with sorted keys (recursive).
 *   4. SHA-256 over the result; hex; first 16 chars.
 *
 * 16 chars (~64 bits) is enough collision-resistance for an eval suite
 * of hundreds of recordings; keeps filenames readable.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  AnthropicMessageParams,
  AnthropicMessageResponse,
  AnthropicCaller,
} from "@/lib/overseer-tools";
import type { RecorderMode } from "./types";

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function stripCacheControl(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) stripCacheControl(item);
    return;
  }
  const obj = value as Record<string, unknown>;
  delete obj.cache_control;
  for (const key of Object.keys(obj)) stripCacheControl(obj[key]);
}

function sortedStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(sortedStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + sortedStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function hashRequest(body: unknown): string {
  const cloned = deepClone(body);
  stripCacheControl(cloned);
  const canonical = sortedStringify(cloned);
  return crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

export interface CreateRecorderOptions {
  mode: RecorderMode;
  /** Directory holding this scenario's recordings (one JSON per hash). */
  scenarioDir: string;
  /** Required when mode === "record". */
  liveCaller?: AnthropicCaller;
}

/**
 * Returns an AnthropicCaller-compatible function. In "replay" mode it
 * loads the response from disk (throws with a clear error if missing).
 * In "record" mode it calls the live API and writes the response.
 */
export function createRecorder(opts: CreateRecorderOptions): AnthropicCaller {
  return async (params, options) => {
    const hash = hashRequest(params);
    const filePath = path.join(opts.scenarioDir, `${hash}.json`);

    if (opts.mode === "replay") {
      if (!fs.existsSync(filePath)) {
        throw new Error(
          `[recorder] no recording at ${filePath} (request hash ${hash}). ` +
            `Run \`pnpm eval:refresh\` to capture a fresh recording.`
        );
      }
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as AnthropicMessageResponse;
    }

    if (!opts.liveCaller) {
      throw new Error(
        "[recorder] mode=record requires a liveCaller. Pass one when constructing the recorder."
      );
    }

    const response = await opts.liveCaller(
      params as AnthropicMessageParams,
      options
    );
    fs.mkdirSync(opts.scenarioDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(response, null, 2) + "\n");
    return response;
  };
}
