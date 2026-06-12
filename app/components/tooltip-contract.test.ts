import { describe, it, expect } from "vitest";

// Canonical tooltip strings for all nav items and dashboard buttons.
// These must match what's rendered in sidebar.tsx, scan-button.tsx,
// morning-briefing.tsx, and app/page.tsx.
const navTooltips: string[] = [
  "Project overview — health, progress, activity",
  "Talk to your AI dispatcher",
  "Things only you can do",
  "All projects with progress bars",
  "Rules for dispatched Claude sessions",
  "Lessons harvested from your projects",
  "Launch a new project with the wizard",
  "Generate project and fleet reports",
  "Manage kickoff templates",
  "Theme, notifications, sounds, automation",
];

const buttonTooltips: string[] = [
  "Re-scan your projects directory for changes",
  "Extract lessons from all project histories",
  "Dispatch Claude to all building projects",
  "Generate an AI summary of your fleet status",
];

describe("tooltip contract", () => {
  it("all nav tooltip strings are under 60 characters", () => {
    navTooltips.forEach((tooltip) => {
      expect(tooltip.length, `"${tooltip}" (${tooltip.length}) exceeds 60 chars`).toBeLessThanOrEqual(60);
    });
  });

  it("all button tooltip strings are under 60 characters", () => {
    buttonTooltips.forEach((tooltip) => {
      expect(tooltip.length, `"${tooltip}" (${tooltip.length}) exceeds 60 chars`).toBeLessThanOrEqual(60);
    });
  });
});
