/**
 * Phase 31 — closes audit finding [30.D6].
 *
 * `JSON.parse(lesson.tags)` was inlined into JSX in two knowledge
 * pages with no guard, so a single malformed `tags` row would crash
 * the entire page render. The third site (`lesson/[id]/page.tsx`)
 * already wrapped the same parse in try/catch. This file centralizes
 * the parse + array-coercion logic so all three sites use it.
 */
import { describe, it, expect } from "vitest";
import { parseLessonTags } from "./lesson-utils";

describe("parseLessonTags", () => {
  it("returns the parsed array on valid JSON", () => {
    expect(parseLessonTags('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseLessonTags("not json {")).toEqual([]);
  });

  it("returns [] on null / undefined input", () => {
    expect(parseLessonTags(null as unknown as string)).toEqual([]);
    expect(parseLessonTags(undefined as unknown as string)).toEqual([]);
  });

  it("returns [] on empty string", () => {
    expect(parseLessonTags("")).toEqual([]);
  });

  it("returns [] when JSON is valid but not an array", () => {
    expect(parseLessonTags('"a string"')).toEqual([]);
    expect(parseLessonTags("42")).toEqual([]);
    expect(parseLessonTags('{"a":1}')).toEqual([]);
  });

  it("coerces non-string array members to strings (matches lesson/[id] semantics)", () => {
    expect(parseLessonTags("[1,2,3]")).toEqual(["1", "2", "3"]);
  });
});
