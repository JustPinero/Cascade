// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { ProjectTile, type ProjectTileData } from "./project-tile";

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

const baseProject: ProjectTileData = {
  slug: "test-project",
  name: "Test Project",
  currentPhase: "phase-2-dashboard",
  health: "healthy",
  openDebtCount: 0,
  lastActivityAt: new Date().toISOString(),
  status: "building",
  githubRepo: "user/test-project",
};

describe("ProjectTile", () => {
  it("renders project name", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    expect(container!.textContent).toContain("Test Project");
  });

  it("renders current phase", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    expect(container!.textContent).toContain("P2 dashboard");
  });

  it("renders status badge", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    expect(container!.textContent).toContain("building");
  });

  it("shows no debt when count is 0", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    expect(container!.textContent).toContain("no debt");
  });

  it("shows debt count when > 0", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectTile project={{ ...baseProject, openDebtCount: 3 }} />
      );
      container = result.container;
    });
    expect(container!.textContent).toContain("3 debt");
  });

  it("links to project detail page", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    const link = container!.querySelector("a");
    expect(link!.getAttribute("href")).toBe("/projects/test-project");
  });

  it("renders health indicator with correct pulse class for healthy", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(<ProjectTile project={baseProject} />);
      container = result.container;
    });
    const indicator = container!.querySelector(".pulse-healthy");
    expect(indicator).not.toBeNull();
  });

  it("renders warning health indicator", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectTile project={{ ...baseProject, health: "warning" }} />
      );
      container = result.container;
    });
    const indicator = container!.querySelector(".pulse-warning");
    expect(indicator).not.toBeNull();
  });

  it("renders blocked health indicator", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectTile project={{ ...baseProject, health: "blocked" }} />
      );
      container = result.container;
    });
    const indicator = container!.querySelector(".pulse-blocked");
    expect(indicator).not.toBeNull();
  });

  it("renders idle health indicator without pulse", async () => {
    let container: HTMLElement;
    await act(async () => {
      const result = render(
        <ProjectTile project={{ ...baseProject, health: "idle" }} />
      );
      container = result.container;
    });
    const pulses = container!.querySelectorAll(
      ".pulse-healthy, .pulse-warning, .pulse-blocked"
    );
    expect(pulses).toHaveLength(0);
  });
});
