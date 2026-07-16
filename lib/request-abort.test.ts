import { describe, it, expect } from "vitest";
import { linkAbort } from "./request-abort";

describe("linkAbort", () => {
  it("propagates request abort", () => {
    const source = new AbortController();
    const target = new AbortController();
    linkAbort(source.signal, target);
    expect(target.signal.aborted).toBe(false);
    source.abort();
    expect(target.signal.aborted).toBe(true);
  });

  it("aborts immediately when the source is already aborted", () => {
    const source = new AbortController();
    source.abort();
    const target = new AbortController();
    linkAbort(source.signal, target);
    expect(target.signal.aborted).toBe(true);
  });
});
