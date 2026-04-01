// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { LoadingSkeleton } from "./loading-skeleton";

describe("LoadingSkeleton", () => {
  it("renders with pulse animation", () => {
    const { container } = render(<LoadingSkeleton />);
    const pulse = container.querySelector(".animate-pulse");
    expect(pulse).not.toBeNull();
  });

  it("renders skeleton blocks", () => {
    const { container } = render(<LoadingSkeleton />);
    const blocks = container.querySelectorAll(".bg-space-700");
    expect(blocks.length).toBeGreaterThan(0);
  });
});
