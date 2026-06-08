// @vitest-environment jsdom
/**
 * Phase 28 — PlatformBadge tests.
 *
 * The badge fetches /api/preflight on mount and renders platform +
 * an indicator color reflecting ok/missing. Tests stub fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import { PlatformBadge } from "./platform-badge";

function mockFetchOnce(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PlatformBadge", () => {
  it("calls /api/preflight on mount and renders the platform label", async () => {
    const fetchMock = mockFetchOnce({
      platform: "windows",
      ok: true,
      missing: [],
      tools: {},
    });

    let container: HTMLElement;
    await act(async () => {
      const r = render(<PlatformBadge />);
      container = r.container;
    });
    await waitFor(() => {
      expect(container!.textContent?.toLowerCase()).toContain("windows");
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/preflight");
  });

  it("shows a healthy indicator class when ok=true", async () => {
    mockFetchOnce({
      platform: "linux",
      ok: true,
      missing: [],
      tools: {},
    });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<PlatformBadge />);
      container = r.container;
    });
    await waitFor(() => {
      const dot = container!.querySelector("[data-testid='platform-dot']");
      expect(dot).not.toBeNull();
      expect(dot!.className).toMatch(/bg-success/);
    });
  });

  it("shows a warning indicator and lists missing tools when ok=false", async () => {
    mockFetchOnce({
      platform: "windows",
      ok: false,
      missing: ["wt.exe", "bash"],
      tools: { claude: "C:\\x", "wt.exe": null, bash: null },
    });
    let container: HTMLElement;
    await act(async () => {
      const r = render(<PlatformBadge />);
      container = r.container;
    });
    await waitFor(() => {
      const dot = container!.querySelector("[data-testid='platform-dot']");
      expect(dot!.className).toMatch(/bg-amber|bg-warning|bg-danger/);
    });
    const root = container!.querySelector("[data-testid='platform-badge']");
    expect(root!.getAttribute("title")).toMatch(/wt\.exe/);
    expect(root!.getAttribute("title")).toMatch(/bash/);
  });

  it("renders nothing while loading and recovers gracefully on fetch failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    let container: HTMLElement;
    await act(async () => {
      const r = render(<PlatformBadge />);
      container = r.container;
    });
    // Doesn't throw, doesn't render the badge once the fetch fails.
    await waitFor(() => {
      expect(container!.querySelector("[data-testid='platform-badge']")).toBeNull();
    });
  });
});
