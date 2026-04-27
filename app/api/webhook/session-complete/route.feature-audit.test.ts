import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuditProjectFeatureUsage = vi.fn();
const mockImportSingleProject = vi.fn();
const mockGetSessionLogs = vi.fn();
const mockDetectEscalations = vi.fn();
const mockReleaseSlot = vi.fn();

const mockProjectFindUnique = vi.fn();
const mockActivityEventCreate = vi.fn();
const mockActivityEventFindFirst = vi.fn();
const mockHumanTaskCreate = vi.fn();
const mockDispatchOutcomeCreate = vi.fn();

vi.mock("@/lib/anthropic-feature-check", () => ({
  auditProjectFeatureUsage: (...a: unknown[]) =>
    mockAuditProjectFeatureUsage(...a),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findUnique: (...a: unknown[]) => mockProjectFindUnique(...a) },
    activityEvent: {
      create: (...a: unknown[]) => mockActivityEventCreate(...a),
      findFirst: (...a: unknown[]) => mockActivityEventFindFirst(...a),
    },
    humanTask: { create: (...a: unknown[]) => mockHumanTaskCreate(...a) },
    dispatchOutcome: {
      create: (...a: unknown[]) => mockDispatchOutcomeCreate(...a),
    },
  },
}));

vi.mock("@/lib/project-import", () => ({
  importSingleProject: (...a: unknown[]) => mockImportSingleProject(...a),
}));

vi.mock("@/lib/scanner", () => ({
  toSlug: (s: string) => s.toLowerCase(),
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: (...a: unknown[]) => mockGetSessionLogs(...a),
}));

vi.mock("@/lib/escalation-detector", () => ({
  detectEscalations: (...a: unknown[]) => mockDetectEscalations(...a),
}));

vi.mock("@/lib/dispatch-queue", () => ({
  getDispatchQueue: () => ({ release: mockReleaseSlot }),
}));

import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  mockImportSingleProject.mockResolvedValue({
    name: "demo",
    slug: "demo",
    action: "updated",
  });
  mockProjectFindUnique.mockResolvedValue({ id: 42, slug: "demo", health: "healthy" });
  mockActivityEventCreate.mockResolvedValue({ id: 1 });
  mockActivityEventFindFirst.mockResolvedValue(null);
  mockGetSessionLogs.mockResolvedValue([]);
  mockDetectEscalations.mockReturnValue([]);
});

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/webhook/session-complete", {
    method: "POST",
    body: JSON.stringify({ projectPath: "/tmp/demo" }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/webhook/session-complete — feature audit hook (phase 11.1)", () => {
  it("calls auditProjectFeatureUsage for the project after escalation processing", async () => {
    mockAuditProjectFeatureUsage.mockResolvedValue({
      projectId: 42,
      projectPath: "/tmp/demo",
      detected: [],
      removed: 0,
      skippedFeatures: [],
    });

    const { POST } = await import(
      "@/app/api/webhook/session-complete/route"
    );
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(mockAuditProjectFeatureUsage).toHaveBeenCalledTimes(1);
    expect(mockAuditProjectFeatureUsage).toHaveBeenCalledWith(
      expect.anything(),
      42,
    );
  });

  it("does NOT fail the webhook when the audit throws", async () => {
    mockAuditProjectFeatureUsage.mockRejectedValue(
      new Error("audit blew up"),
    );

    const { POST } = await import(
      "@/app/api/webhook/session-complete/route"
    );
    const res = await POST(makeRequest());

    expect(res.status).toBe(200); // success despite audit failure
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("skips the audit if the project record was not found", async () => {
    mockProjectFindUnique.mockResolvedValue(null);
    mockAuditProjectFeatureUsage.mockResolvedValue({
      projectId: 0,
      projectPath: "",
      detected: [],
      removed: 0,
      skippedFeatures: [],
    });

    const { POST } = await import(
      "@/app/api/webhook/session-complete/route"
    );
    await POST(makeRequest());

    expect(mockAuditProjectFeatureUsage).not.toHaveBeenCalled();
  });
});
