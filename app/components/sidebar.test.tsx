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

  it("nav items have tooltips as title attributes", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    const linksWithTitle = Array.from(container!.querySelectorAll("a[title]"));
    expect(linksWithTitle.length).toBeGreaterThanOrEqual(10);
  });

  it("Dashboard nav item tooltip is correct", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    const dashboardLink = container!.querySelector('a[href="/"]')!;
    expect(dashboardLink.getAttribute("title")).toBe(
      "Project overview — health, progress, activity"
    );
  });

  it("all nav tooltip strings are under 60 characters", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Sidebar />);
      container = result.container;
    });
    const links = Array.from(container!.querySelectorAll("a[title]"));
    links.forEach((link) => {
      const t = link.getAttribute("title")!;
      expect(t.length, `"${t}" exceeds 60 chars`).toBeLessThanOrEqual(60);
    });
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
