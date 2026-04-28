import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProposeForAll = vi.fn();
const mockRenderProposalReport = vi.fn();
const mockIsProposeCommand = vi.fn();
const mockParseProposeArgs = vi.fn();

vi.mock("@/lib/anthropic-feature-proposer", () => ({
  proposeForAll: (...a: unknown[]) => mockProposeForAll(...a),
  renderProposalReport: (...a: unknown[]) => mockRenderProposalReport(...a),
  isFeatureProposeCommand: (...a: unknown[]) => mockIsProposeCommand(...a),
  parseFeatureProposeArgs: (...a: unknown[]) => mockParseProposeArgs(...a),
}));

vi.mock("@/lib/anthropic-feature-check", () => ({
  isFeatureCheckCommand: vi.fn().mockReturnValue(false),
  runFeatureCheck: vi.fn(),
  renderFeatureCheckReport: vi.fn(),
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
  mockIsProposeCommand.mockImplementation((s: string) =>
    /^\s*\/anthropic-feature-propose\b/i.test(s),
  );
  mockParseProposeArgs.mockImplementation((s: string) => {
    const m = s.match(/^\s*\/anthropic-feature-propose\s+(.*)$/i);
    if (!m) return { projectSlugs: [] };
    return {
      projectSlugs: m[1]
        .trim()
        .split(/\s+/)
        .filter((t: string) => t.length > 0 && !t.startsWith("--")),
    };
  });
  mockProposeForAll.mockResolvedValue([
    {
      projectName: "demo",
      projectPath: "/tmp/demo",
      proposals: [],
    },
  ]);
  mockRenderProposalReport.mockReturnValue(
    "# Anthropic Feature Proposals\n\nMocked proposal report.",
  );
});

function makeRequest(messages: { role: string; content: string }[]): NextRequest {
  return new NextRequest("http://localhost:3000/api/overseer/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/overseer/chat — propose slash command (phase 11.2)", () => {
  it("triggers proposeForAll on /anthropic-feature-propose", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest([{ role: "user", content: "/anthropic-feature-propose" }]),
    );
    expect(mockIsProposeCommand).toHaveBeenCalled();
    expect(mockProposeForAll).toHaveBeenCalledTimes(1);
    expect(mockRenderProposalReport).toHaveBeenCalledTimes(1);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("emits the rendered proposal report inside an SSE text_delta event", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest([{ role: "user", content: "/anthropic-feature-propose" }]),
    );
    const body = await res.text();
    expect(body).toContain("event: message_start");
    expect(body).toContain("Mocked proposal report");
  });

  it("passes parsed project slugs through to proposeForAll", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest([
        { role: "user", content: "/anthropic-feature-propose ratracer cascade" },
      ]),
    );
    expect(mockProposeForAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectSlugs: ["ratracer", "cascade"] }),
    );
  });

  it("calls proposeForAll with no slug filter when none given", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest([{ role: "user", content: "/anthropic-feature-propose" }]),
    );
    const callArg = mockProposeForAll.mock.calls[0]![1];
    expect(callArg.projectSlugs).toBeUndefined();
  });

  it("does NOT trigger propose on a normal message", async () => {
    const { POST } = await import("@/app/api/overseer/chat/route");
    try {
      await POST(makeRequest([{ role: "user", content: "Hello" }]));
    } catch {
      // Claude fetch may fail; that's not what we're testing.
    }
    expect(mockProposeForAll).not.toHaveBeenCalled();
  });
});
