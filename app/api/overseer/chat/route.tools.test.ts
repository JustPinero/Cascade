import { describe, it, expect, vi, beforeEach } from "vitest";

// -- Mock the Anthropic caller factory so runToolUseLoop drives a
// canned response sequence instead of hitting the real API.
const mockCaller = vi.fn();
vi.mock("@/lib/overseer-tools", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/overseer-tools")>(
      "@/lib/overseer-tools"
    );
  return {
    ...actual,
    defaultAnthropicCaller: vi.fn(() => mockCaller),
  };
});

// -- Prisma mock with a single project.
const mockProject = {
  id: 1,
  name: "Cascade",
  slug: "cascade",
  path: "/tmp/cascade",
  status: "building",
  health: "healthy",
  currentPhase: "phase-12-overseer-tools",
  progressScore: 60,
  progressDetails: "{}",
  healthDetails: "{}",
  businessStage: "internal",
  projectContext: null,
  completionCriteria: null,
  currentRequest: null,
  lastSessionEndedAt: null,
};

// In-memory ChatSession for the route's getOrCreateSession call.
const mockSession = {
  id: "sess-test",
  startedAt: new Date(),
  closedAt: null,
  activeFlow: null,
  workingMemory: "{}",
};

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        where.slug === "cascade" ? mockProject : null
      ),
      findMany: vi.fn().mockResolvedValue([]),
    },
    activityEvent: { findMany: vi.fn().mockResolvedValue([]) },
    chatMessage: { findMany: vi.fn().mockResolvedValue([]) },
    dispatchOutcome: { findMany: vi.fn().mockResolvedValue([]) },
    chatSession: {
      findFirst: vi.fn().mockResolvedValue(mockSession),
      create: vi.fn().mockResolvedValue(mockSession),
      findUnique: vi.fn().mockResolvedValue(mockSession),
    },
  },
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

vi.mock("@/lib/anthropic-feature-check", () => ({
  isFeatureCheckCommand: vi.fn().mockReturnValue(false),
  runFeatureCheck: vi.fn(),
  renderFeatureCheckReport: vi.fn(),
}));

vi.mock("@/lib/anthropic-feature-proposer", () => ({
  isFeatureProposeCommand: vi.fn().mockReturnValue(false),
  parseFeatureProposeArgs: vi.fn(),
  proposeForAll: vi.fn(),
  renderProposalReport: vi.fn(),
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn().mockResolvedValue([]),
}));

import { NextRequest } from "next/server";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-test";
});

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/overseer/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function toolUseResponse(blocks: Array<{ id: string; name: string; input: Record<string, unknown> }>) {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: blocks.map((b) => ({
      type: "tool_use" as const,
      id: b.id,
      name: b.name,
      input: b.input,
    })),
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

function textResponse(text: string) {
  return {
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: [{ type: "text" as const, text }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

describe("POST /api/overseer/chat — tool-use path (default after 12B.3)", () => {
  it("runs query_project and returns final text via SSE", async () => {
    mockCaller
      .mockResolvedValueOnce(
        toolUseResponse([
          { id: "t1", name: "query_project", input: { slug: "cascade" } },
        ])
      )
      .mockResolvedValueOnce(textResponse("Cascade is healthy at phase-12."));

    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "How is cascade?" }],
        useTools: true,
      })
    );

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    const body = await res.text();
    expect(body).toContain("Cascade is healthy at phase-12.");
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: content_block_delta");
    expect(body).toContain("event: message_stop");

    expect(mockCaller).toHaveBeenCalledTimes(2);
  });

  it("forwards a tool-using system prompt that mentions tools and advertises the full registry", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        useTools: true,
      })
    );

    expect(mockCaller).toHaveBeenCalledTimes(1);
    const params = mockCaller.mock.calls[0][0];
    expect(params.system.toLowerCase()).toContain("tool");

    // After 12B the registry advertises 8 read tools. Assert the key
    // ones are present so the model has the full read surface.
    const toolNames: string[] = params.tools.map((t: { name: string }) => t.name);
    for (const name of [
      "query_project",
      "query_projects",
      "get_recent_activity",
      "get_session_logs",
      "get_dispatch_outcomes",
      "get_yesterday_summary",
      "get_engineer_messages",
      "get_playbook",
    ]) {
      expect(toolNames).toContain(name);
    }
  });

  it("runs the tool-use loop on every conversational request (Phase 12F: tool-only)", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "Plain chat." }],
      })
    );

    expect(mockCaller).toHaveBeenCalledTimes(1);
  });

  it("ignores `useTools: false` after Phase 12F — the legacy path no longer exists", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "Plain chat." }],
        useTools: false,
      })
    );

    // useTools:false used to bypass to legacy. Now it's a no-op flag.
    expect(mockCaller).toHaveBeenCalledTimes(1);
  });
});
