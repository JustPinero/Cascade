// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { ProjectGrid } from "./project-grid";
import type { ProjectTileData } from "./project-tile";

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

const mockProjects: ProjectTileData[] = [
  {
    slug: "alpha",
    name: "Alpha",
    currentPhase: "phase-1-foundation",
    health: "healthy",
    openDebtCount: 0,
    lastActivityAt: new Date().toISOString(),
    status: "building",
    githubRepo: null,
  },
  {
    slug: "beta",
    name: "Beta",
    currentPhase: "phase-2-dashboard",
    health: "warning",
    openDebtCount: 2,
    lastActivityAt: new Date().toISOString(),
    status: "deployed",
    githubRepo: null,
  },
  {
    slug: "gamma",
    name: "Gamma",
    currentPhase: "phase-1-foundation",
    health: "blocked",
    openDebtCount: 5,
    lastActivityAt: new Date().toISOString(),
    status: "building",
    githubRepo: null,
  },
];

describe("ProjectGrid", () => {
  it("renders correct number of tiles", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectGrid projects={mockProjects} loading={false} />
      );
      container = result.container;
    });
    const links = container!.querySelectorAll("a");
    expect(links).toHaveLength(3);
  });

  it("renders loading skeleton", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectGrid projects={[]} loading={true} />
      );
      container = result.container;
    });
    const skeletons = container!.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders empty state when no projects", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectGrid projects={[]} loading={false} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("No projects match");
  });

  it("renders grouped view by status", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectGrid
          projects={mockProjects}
          loading={false}
          groupBy="status"
        />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Active Build");
    expect(container!.textContent).toContain("Deployed");
  });

  it("shows project names in grid", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectGrid projects={mockProjects} loading={false} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("Alpha");
    expect(container!.textContent).toContain("Beta");
    expect(container!.textContent).toContain("Gamma");
  });
});
