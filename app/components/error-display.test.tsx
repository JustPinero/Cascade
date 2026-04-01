// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { ErrorDisplay } from "./error-display";

describe("ErrorDisplay", () => {
  it("renders error message", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ErrorDisplay
          error={new Error("Something went wrong")}
          reset={() => {}}
        />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Something went wrong");
  });

  it("renders retry button", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ErrorDisplay error={new Error("fail")} reset={() => {}} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Retry");
  });

  it("calls reset on retry click", async () => {
    const reset = vi.fn();
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ErrorDisplay error={new Error("fail")} reset={reset} />
      );
      container = result.container;
    });
    const button = container!.querySelector("button")!;
    await act(async () => {
      fireEvent.click(button);
    });
    expect(reset).toHaveBeenCalledOnce();
  });
});
