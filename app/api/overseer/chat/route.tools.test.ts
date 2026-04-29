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

vi.mock("@/lib/db", () => {
  const prismaMock = {
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
      update: vi.fn().mockResolvedValue(mockSession),
    },
    // Phase 13.1 — getOrCreateSession is wrapped in $transaction.
    // The mock just invokes the callback with the same prisma mock.
    $transaction: vi.fn(
      async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock)
    ),
  };
  return { prisma: prismaMock };
});

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

// Phase 13.4 — replace the default summarizer with a deterministic
// stub so we can assert the compressor was invoked end-to-end.
const summarizerStub = vi.fn().mockResolvedValue("compressed-summary-stub");
vi.mock("@/lib/chat-history-compressor", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/chat-history-compressor")>(
      "@/lib/chat-history-compressor"
    );
  return {
    ...actual,
    defaultSummarizer: vi.fn(() => summarizerStub),
  };
});

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

  it("invokes the compressor when the conversation exceeds the threshold (Phase 13.4)", async () => {
    summarizerStub.mockClear();
    summarizerStub.mockResolvedValue("compressed-summary-stub");
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    // 30 messages — above the 25-threshold the route uses
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `historical message ${i}`,
    }));

    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest({ messages, useTools: true })
    );
    if (res.status !== 200) {
      const body = await res.json();
      throw new Error(`Route returned 500: ${JSON.stringify(body)}`);
    }
    expect(res.status).toBe(200);

    expect(summarizerStub).toHaveBeenCalledTimes(1);

    // The caller should have received the compressed view: 1 summary
    // message + the 10 most recent verbatim = 11.
    expect(mockCaller).toHaveBeenCalledTimes(1);
    const params = mockCaller.mock.calls[0][0];
    expect(params.messages.length).toBe(11);
    expect(params.messages[0].content).toContain(
      "Earlier conversation summary"
    );
    expect(params.messages[0].content).toContain("compressed-summary-stub");
  });

  it("uses body.sessionDate when provided (Phase 14.1)", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));
    const findFirstSpy = vi.mocked(
      (await import("@/lib/db")).prisma.chatSession.findFirst
    );
    findFirstSpy.mockClear();

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        sessionDate: "2026-01-15",
      })
    );

    // The session lookup should have been keyed against 2026-01-15,
    // not the server's UTC today.
    const lookupArgs = findFirstSpy.mock.calls[0]?.[0] as
      | { where: { startedAt: { gte: Date; lt: Date } } }
      | undefined;
    expect(lookupArgs).toBeDefined();
    const start = lookupArgs!.where.startedAt.gte;
    expect(start.toISOString().startsWith("2026-01-15")).toBe(true);
  });

  it("ignores malformed body.sessionDate and falls back to server UTC (Phase 14.1)", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));
    const findFirstSpy = vi.mocked(
      (await import("@/lib/db")).prisma.chatSession.findFirst
    );
    findFirstSpy.mockClear();

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        sessionDate: "not-a-date",
      })
    );

    const lookupArgs = findFirstSpy.mock.calls[0]?.[0] as
      | { where: { startedAt: { gte: Date } } }
      | undefined;
    const today = new Date().toISOString().split("T")[0];
    expect(lookupArgs!.where.startedAt.gte.toISOString().startsWith(today)).toBe(
      true
    );
  });

  it("returns 500 when ANTHROPIC_API_KEY is missing (Phase 14.7)", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const { POST } = await import("@/app/api/overseer/chat/route");
    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }] })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/ANTHROPIC_API_KEY/i);
    expect(mockCaller).not.toHaveBeenCalled();
  });

  it("registers exactly the documented set of tools (Phase 14.7)", async () => {
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({ messages: [{ role: "user", content: "hi" }] })
    );

    const params = mockCaller.mock.calls[0][0];
    const toolNames = params.tools
      .map((t: { name: string }) => t.name)
      .sort();

    // Exact-set assertion (not just subset) — adding a new tool should
    // require updating this list, which forces a deliberate decision
    // about advertising it to the model.
    expect(toolNames).toEqual(
      [
        "create_human_todo",
        "create_reminder",
        "get_dispatch_outcomes",
        "get_engineer_messages",
        "get_playbook",
        "get_recent_activity",
        "get_session_logs",
        "get_session_state",
        "get_yesterday_summary",
        "propose_dispatch",
        "query_project",
        "query_projects",
        "set_active_flow",
        "update_session_memory",
      ].sort()
    );
  });

  it("does NOT invoke the compressor on a short conversation", async () => {
    summarizerStub.mockClear();
    mockCaller.mockResolvedValueOnce(textResponse("ok"));

    const { POST } = await import("@/app/api/overseer/chat/route");
    await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        useTools: true,
      })
    );

    expect(summarizerStub).not.toHaveBeenCalled();
  });

});
