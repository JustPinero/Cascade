// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import { ScanButton } from "./scan-button";

describe("ScanButton", () => {
  it("renders with tooltip title attribute", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ScanButton onScanComplete={() => {}} />);
      container = result.container;
    });
    const button = container!.querySelector("button")!;
    expect(button.title).toBe("Re-scan your projects directory for changes");
  });
});
