// @vitest-environment jsdom
/**
 * Phase 41.4 — fleet drift panel: minimal dashboard surface for
 * reconciliation findings (a count + list).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { FleetDriftPanel } from "./fleet-drift-panel";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubReconciliation(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () => body,
    }))
  );
}

const DRIFTED = {
  generatedAt: new Date().toISOString(),
  findingsCount: 2,
  projects: [
    {
      slug: "labwebsite",
      name: "labwebsite",
      findings: [
        {
          type: "dirty-tree",
          severity: "warning",
          message: "1246 uncommitted files in working tree",
        },
        {
          type: "status-drift",
          severity: "warning",
          message: "status 'complete' contradicts local state",
        },
      ],
    },
  ],
};

describe("FleetDriftPanel", () => {
  it("renders a drift count and per-project findings", async () => {
    stubReconciliation(DRIFTED);
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetDriftPanel />);
      container = result.container;
    });

    const panel = container!.querySelector('[data-testid="fleet-drift-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("2");
    expect(panel!.textContent).toContain("labwebsite");
    expect(panel!.textContent).toContain("1246 uncommitted files");
  });

  it("renders nothing when there is no drift", async () => {
    stubReconciliation({
      generatedAt: new Date().toISOString(),
      findingsCount: 0,
      projects: [],
    });
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetDriftPanel />);
      container = result.container;
    });

    expect(
      container!.querySelector('[data-testid="fleet-drift-panel"]')
    ).toBeNull();
  });

  it("renders nothing when the fetch fails", async () => {
    stubReconciliation({}, false);
    let container: HTMLElement;
    await act(async () => {
      const result = render(<FleetDriftPanel />);
      container = result.container;
    });

    expect(
      container!.querySelector('[data-testid="fleet-drift-panel"]')
    ).toBeNull();
  });
});
