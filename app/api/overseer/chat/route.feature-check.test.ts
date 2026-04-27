import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunFeatureCheck = vi.fn();
const mockIsFeatureCheckCommand = vi.fn();
const mockRenderFeatureCheckReport = vi.fn();

vi.mock("@/lib/anthropic-feature-check", () => ({
  runFeatureCheck: (...a: unknown[]) => mockRunFeatureCheck(...a),
  isFeatureCheckCommand: (...a: unknown[]) =>
    mockIsFeatureCheckCommand(...a),
  renderFeatureCheckReport: (...a: unknown[]) =>
    mockRenderFeatureCheckReport(...a),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findMany: vi.fn().mockResolvedValue([]) },
    activityEvent: { findMany: vi.fn().mockResolvedValue([]) },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    dispatchOutcome: { findMany: vi.fn().mockResolvedValue([]) },
    upstreamFeature: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockReturnValue(null),
  getRateLimitKey: vi.fn().mockReturnValue("k"),
}));

vi.mock("@/lib/chat-validation", () => ({
  validateMessages: vi.fn((messages: unknown) => ({
    valid: true,
    messages: messages as { role: string; content: string }[],
  })),
}));

import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  mockIsFeatureCheckCommand.mockImplementation((s: string) =>
    /^\s*\/anthropic-feature-update-check\b/i.test(s),
  );
  mockRunFeatureCheck.mockResolvedValue({
    catalogSync: { added: 0, updated: 0, unchanged: 21, total: 21 },
    newCandidates: [],
    droppedLowConfidence: [],
    fetchedSources: [],
    usage: { totalProjects: 0, perProject: [] },
  });
  mockRenderFeatureCheckReport.mockReturnValue(
    "# Anthropic Feature Update Check\n\nMocked report.",
  );
});

function makeRequest(messages: { role: string; content: string }[]): NextRequest {
  return new NextRequest("http://localhost:3000/api/overseer/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/overseer/chat — slash command interception", () => {
  it("triggers runFeatureCheck when the latest user message is /anthropic-feature-update-check", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest([{ role: "user", content: "/anthropic-feature-update-check" }]),
    );

    expect(mockIsFeatureCheckCommand).toHaveBeenCalled();
    expect(mockRunFeatureCheck).toHaveBeenCalledTimes(1);
    expect(mockRenderFeatureCheckReport).toHaveBeenCalledTimes(1);

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("emits the rendered report inside an SSE text_delta event", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest([{ role: "user", content: "/anthropic-feature-update-check" }]),
    );
    const body = await res.text();
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: content_block_delta");
    expect(body).toContain("Mocked report");
    expect(body).toContain("event: message_stop");
  });

  it("does NOT trigger feature-check on a normal message (existing chat flow preserved)", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    // We intentionally don't mock the Claude fetch; it'll throw.
    // The point of this test is just to confirm the slash branch
    // didn't fire — i.e. mockRunFeatureCheck is NEVER called.
    try {
      await POST(makeRequest([{ role: "user", content: "Hello, Overseer." }]));
    } catch {
      // Claude API call may fail in test env — fine.
    }
    expect(mockRunFeatureCheck).not.toHaveBeenCalled();
  });

  it("matches the slash command case-insensitively", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest([
        { role: "user", content: "/Anthropic-Feature-Update-Check" },
      ]),
    );
    expect(mockRunFeatureCheck).toHaveBeenCalledTimes(1);
  });
});
