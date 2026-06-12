// @vitest-environment jsdom
/**
 * Phase 39 [P8] — cost widget smoke tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { CostWidget } from "./cost-widget";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSummary(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () => body,
    }))
  );
}

describe("CostWidget", () => {
  it("renders cost, call count, and cache hit rate", async () => {
    stubSummary({
      calls: 12,
      estimatedCostUsd: 0.4321,
      hitRate: 0.72,
      hasUnknownModels: false,
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<CostWidget />);
      container = result.container;
    });

    const text = container!.querySelector(
      '[data-testid="cost-widget"]'
    )!.textContent;
    expect(text).toContain("$0.43");
    expect(text).toContain("12 calls");
    expect(text).toContain("cache 72%");
    expect(text).not.toContain("~");
  });

  it("marks the figure approximate when unknown models were priced", async () => {
    stubSummary({
      calls: 1,
      estimatedCostUsd: 1.5,
      hitRate: 0,
      hasUnknownModels: true,
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<CostWidget />);
      container = result.container;
    });

    const text = container!.querySelector(
      '[data-testid="cost-widget"]'
    )!.textContent;
    expect(text).toContain("~$1.50");
  });

  it("renders nothing when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    let container: HTMLElement;
    await act(async () => {
      const result = render(<CostWidget />);
      container = result.container;
    });

    expect(container!.querySelector('[data-testid="cost-widget"]')).toBeNull();
  });
});
