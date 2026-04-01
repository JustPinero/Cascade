import { describe, it, expect } from "vitest";
import { singleReportToPdf, crossReportToPdf } from "./report-pdf";
import type {
  SingleProjectReport,
  CrossProjectReport,
} from "./report-generator";

const mockSingleReport: SingleProjectReport = {
  type: "single",
  projectName: "Test Project",
  currentPhase: "phase-2-dashboard",
  status: "building",
  health: "warning",
  audits: [
    { type: "test-audit", grade: "B", date: "2026-03-15T00:00:00Z" },
    { type: "bughunt", grade: "A", date: "2026-03-16T00:00:00Z" },
  ],
  openDebt: ["Fix login timeout", "Refactor auth module"],
  resolvedDebt: [],
  timeline: [
    {
      event: "commit",
      summary: "Added dashboard tiles",
      date: "2026-03-15T00:00:00Z",
    },
  ],
  generatedAt: "2026-04-01T00:00:00Z",
};

const mockCrossReport: CrossProjectReport = {
  type: "cross-project",
  projects: [
    {
      name: "Alpha",
      status: "building",
      health: "healthy",
      phase: "phase-3",
    },
    {
      name: "Beta",
      status: "deployed",
      health: "warning",
      phase: "phase-5",
    },
  ],
  totalLessons: 15,
  lessonsByCategory: { database: 5, testing: 4, deployment: 3, auth: 3 },
  activeBlockers: [{ project: "Beta", details: "SSL cert expired" }],
  recentActivity: [],
  generatedAt: "2026-04-01T00:00:00Z",
};

describe("report-pdf", () => {
  it("generates single project PDF buffer", () => {
    const buffer = singleReportToPdf(mockSingleReport);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    // PDF files start with %PDF
    const header = buffer.subarray(0, 4).toString("ascii");
    expect(header).toBe("%PDF");
  });

  it("generates cross-project PDF buffer", () => {
    const buffer = crossReportToPdf(mockCrossReport);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    const header = buffer.subarray(0, 4).toString("ascii");
    expect(header).toBe("%PDF");
  });

  it("single PDF has reasonable size", () => {
    const buffer = singleReportToPdf(mockSingleReport);
    // Should be more than just a header (has tables, text)
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("cross PDF has reasonable size", () => {
    const buffer = crossReportToPdf(mockCrossReport);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
