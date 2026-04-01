// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { Sidebar } from "./sidebar";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock next/link to render a plain anchor
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("Sidebar", () => {
  it("renders the Cascade brand", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    expect(container!.textContent).toContain("Cascade");
  });

  it("renders all navigation items", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    expect(container!.textContent).toContain("Dashboard");
    expect(container!.textContent).toContain("Knowledge Base");
    expect(container!.textContent).toContain("Create Project");
    expect(container!.textContent).toContain("Reports");
    expect(container!.textContent).toContain("Templates");
  });

  it("renders navigation links with correct hrefs", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    const links = container!.querySelectorAll("a");
    const hrefs = Array.from(links).map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/knowledge");
    expect(hrefs).toContain("/create");
    expect(hrefs).toContain("/reports");
    expect(hrefs).toContain("/templates");
  });

  it("shows version in footer", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    expect(container!.textContent).toContain("Delamain v1");
  });
});
