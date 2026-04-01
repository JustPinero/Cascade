// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { DashboardFilters, type FilterState } from "./dashboard-filters";

describe("DashboardFilters", () => {
  const defaultFilters: FilterState = {
    search: "",
    status: null,
    groupBy: "none",
  };

  it("renders search input", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={() => {}} />
      );
      container = result.container;
    });
    const input = container!.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.placeholder).toContain("Search");
  });

  it("renders status filter buttons", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={() => {}} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("All");
    expect(container!.textContent).toContain("Building");
    expect(container!.textContent).toContain("Deployed");
    expect(container!.textContent).toContain("Paused");
  });

  it("calls onChange when search input changes", async () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={onChange} />
      );
      container = result.container;
    });
    const input = container!.querySelector("input")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "test" } });
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ search: "test" })
    );
  });

  it("calls onChange when status button clicked", async () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={onChange} />
      );
      container = result.container;
    });
    const buttons = container!.querySelectorAll("button");
    const buildingBtn = Array.from(buttons).find(
      (b) => b.textContent === "Building"
    );
    await act(async () => {
      fireEvent.click(buildingBtn!);
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: "building" })
    );
  });

  it("shows clear button when filters active", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters
          filters={{ ...defaultFilters, search: "test" }}
          onChange={() => {}}
        />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Clear");
  });

  it("hides clear button when no active filters", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={() => {}} />
      );
      container = result.container;
    });
    expect(container!.textContent).not.toContain("Clear");
  });

  it("toggles group mode", async () => {
    const onChange = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <DashboardFilters filters={defaultFilters} onChange={onChange} />
      );
      container = result.container;
    });
    const groupBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === "Group"
    );
    await act(async () => {
      fireEvent.click(groupBtn!);
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: "status" })
    );
  });
});
