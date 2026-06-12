// @vitest-environment jsdom
/**
 * Phase 38 [P2] — fleet status strip smoke tests.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { FleetStatusStrip } from "./fleet-status-strip";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStatus(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () => body,
    }))
  );
}

const HEALTHY = {
  queue: { running: 1, pending: 0, capacity: 2 },
  dispatches: { queued: 0, started: 1, overdue: 0 },
};

describe("FleetStatusStrip", () => {
  it("renders running/capacity counts after the first fetch", async () => {
    stubStatus(HEALTHY);
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetStatusStrip />);
      container = result.container;
    });

    const counts = container!.querySelector(
      '[data-testid="fleet-counts"]'
    )!;
    expect(counts.textContent).toContain("1/2 running");
    expect(counts.textContent).not.toContain("stuck");
    expect(counts.textContent).not.toContain("queued");
  });

  it("shows queued and stuck segments when present", async () => {
    stubStatus({
      queue: { running: 2, pending: 3, capacity: 2 },
      dispatches: { queued: 3, started: 2, overdue: 1 },
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetStatusStrip />);
      container = result.container;
    });

    const counts = container!.querySelector(
      '[data-testid="fleet-counts"]'
    )!;
    expect(counts.textContent).toContain("2/2 running");
    expect(counts.textContent).toContain("3 queued");
    expect(counts.textContent).toContain("1 stuck");
  });

  it("renders nothing before data and stays empty when the fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetStatusStrip />);
      container = result.container;
    });

    expect(
      container!.querySelector('[data-testid="fleet-status-strip"]')
    ).toBeNull();
  });

  it("renders nothing on a non-OK response", async () => {
    stubStatus({}, false);
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetStatusStrip />);
      container = result.container;
    });

    expect(
      container!.querySelector('[data-testid="fleet-status-strip"]')
    ).toBeNull();
  });
});
