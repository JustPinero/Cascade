// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { NavLink } from "./nav-link";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

const icon = <span data-testid="icon">icon</span>;

describe("NavLink", () => {
  it("renders label and icon", async () => {
    mockUsePathname.mockReturnValue("/other");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/test" label="Test Link" icon={icon} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Test Link");
    expect(container!.textContent).toContain("icon");
  });

  it("highlights active state for exact match on /", async () => {
    mockUsePathname.mockReturnValue("/");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/" label="Home" icon={icon} />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.className).toContain("border-cyan");
    expect(link.className).toContain("text-text-bright");
  });

  it("highlights active state for prefix match", async () => {
    mockUsePathname.mockReturnValue("/knowledge/deployment");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/knowledge" label="Knowledge" icon={icon} />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.className).toContain("border-cyan");
  });

  it("does not highlight inactive links", async () => {
    mockUsePathname.mockReturnValue("/reports");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/knowledge" label="Knowledge" icon={icon} />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.className).toContain("border-transparent");
  });

  it("renders tooltip as title attribute", async () => {
    mockUsePathname.mockReturnValue("/other");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/test" label="Test Link" icon={icon} tooltip="A helpful description" />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.title).toBe("A helpful description");
  });

  it("omits title attribute when tooltip is not provided", async () => {
    mockUsePathname.mockReturnValue("/other");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/test" label="Test Link" icon={icon} />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.title).toBe("");
  });

  it("/ is not active when on other routes", async () => {
    mockUsePathname.mockReturnValue("/knowledge");
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <NavLink href="/" label="Home" icon={icon} />
      );
      container = result.container;
    });
    const link = container!.querySelector("a")!;
    expect(link.className).toContain("border-transparent");
  });
});
