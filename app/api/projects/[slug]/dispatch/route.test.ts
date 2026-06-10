import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the dispatcher — `dispatchClaude` is the side-effect surface we
// don't want to actually call (it spawns terminals + writes dispatch
// rows). `generatePrompt` is mocked to a deterministic string so we can
// assert the route passes the custom prompt through.
vi.mock("@/lib/claude-dispatcher", () => ({
  dispatchClaude: vi.fn(),
  generatePrompt: vi.fn(async () => "test prompt"),
}));

// Mock prisma — only the methods this route touches:
//   project.findUnique, project.update, activityEvent.create
const findUniqueMock = vi.fn();
const updateMock = vi.fn();
const activityCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
    },
    activityEvent: {
      create: (...args: unknown[]) => activityCreateMock(...args),
    },
  },
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { dispatchClaude, generatePrompt } from "@/lib/claude-dispatcher";
import { clearRateLimits } from "@/lib/rate-limiter";

const dispatchClaudeMock = vi.mocked(dispatchClaude);
const generatePromptMock = vi.mocked(generatePrompt);

function makeRequest(body: unknown, opts?: { raw?: string }): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/projects/alpha/dispatch",
    {
      method: "POST",
      body: opts?.raw ?? JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }
  );
}

const fakeProject = {
  id: 1,
  slug: "alpha",
  name: "Alpha",
  path: "/projects/alpha",
  health: "green" as const,
};

beforeEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  activityCreateMock.mockReset();
  dispatchClaudeMock.mockReset();
  generatePromptMock.mockReset();
  generatePromptMock.mockResolvedValue("test prompt");
  clearRateLimits();
});

afterEach(() => {
  // Rate-limiter state is module-level and bleeds across tests when
  // multiple requests share the "local" fallback IP key. Clear after
  // each test so the next test starts fresh.
  clearRateLimits();
});

describe("POST /api/projects/[slug]/dispatch", () => {
  it("returns 400 when mode is missing", async () => {
    const res = await POST(makeRequest({}), {
      params: Promise.resolve({ slug: "alpha" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid mode/);
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(dispatchClaudeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when mode is not in the allowed set", async () => {
    const res = await POST(makeRequest({ mode: "rogue" }), {
      params: Promise.resolve({ slug: "alpha" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/continue, audit, investigate, custom/);
    expect(dispatchClaudeMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the project slug doesn't exist", async () => {
    findUniqueMock.mockResolvedValue(null);

    const res = await POST(makeRequest({ mode: "continue" }), {
      params: Promise.resolve({ slug: "ghost" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Project not found");
    expect(dispatchClaudeMock).not.toHaveBeenCalled();
    expect(activityCreateMock).not.toHaveBeenCalled();
  });

  it("returns 200 with success payload on happy path and writes activity + currentRequest", async () => {
    findUniqueMock.mockResolvedValue(fakeProject);
    dispatchClaudeMock.mockResolvedValue({
      success: true,
      error: null,
      idempotencyKey: "idem-abc",
      dispatchId: "disp-xyz",
    });

    const res = await POST(makeRequest({ mode: "continue" }), {
      params: Promise.resolve({ slug: "alpha" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      mode: "continue",
      idempotencyKey: "idem-abc",
      dispatchId: "disp-xyz",
    });

    expect(activityCreateMock).toHaveBeenCalledTimes(1);
    const activityArg = activityCreateMock.mock.calls[0][0];
    expect(activityArg.data.projectId).toBe(fakeProject.id);
    expect(activityArg.data.eventType).toBe("session-launched");
    expect(activityArg.data.summary).toMatch(/continue/);
    const details = JSON.parse(activityArg.data.details);
    expect(details).toMatchObject({
      mode: "continue",
      idempotencyKey: "idem-abc",
      dispatchId: "disp-xyz",
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const updateArg = updateMock.mock.calls[0][0];
    expect(updateArg.where).toEqual({ slug: "alpha" });
    expect(updateArg.data.currentRequest).toMatch(/continue.*dispatched/);
  });

  it("does NOT write activity or update project when dispatch fails", async () => {
    findUniqueMock.mockResolvedValue(fakeProject);
    dispatchClaudeMock.mockResolvedValue({
      success: false,
      error: "spawn failed",
    });

    const res = await POST(makeRequest({ mode: "audit" }), {
      params: Promise.resolve({ slug: "alpha" }),
    });

    // Route returns 200 with success:false (the dispatcher's failure
    // is reported in the body, not the status). The important
    // invariant is that we DON'T write a fake activity row.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("spawn failed");
    expect(activityCreateMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns 429 after exceeding the rate limit (10/minute)", async () => {
    findUniqueMock.mockResolvedValue(fakeProject);
    dispatchClaudeMock.mockResolvedValue({
      success: true,
      error: null,
      idempotencyKey: "k",
      dispatchId: "d",
    });

    // Fire 10 allowed requests, then expect the 11th to be limited.
    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest({ mode: "continue" }), {
        params: Promise.resolve({ slug: "alpha" }),
      });
      expect(res.status).toBe(200);
    }

    const blocked = await POST(makeRequest({ mode: "continue" }), {
      params: Promise.resolve({ slug: "alpha" }),
    });
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error).toMatch(/Too many requests/i);
  });

  it("returns 500 on unhandled exception (malformed JSON body)", async () => {
    const res = await POST(makeRequest(null, { raw: "{not json" }), {
      params: Promise.resolve({ slug: "alpha" }),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(dispatchClaudeMock).not.toHaveBeenCalled();
  });

  it("threads customPrompt through to generatePrompt + dispatchClaude in custom mode", async () => {
    findUniqueMock.mockResolvedValue(fakeProject);
    dispatchClaudeMock.mockResolvedValue({
      success: true,
      error: null,
      idempotencyKey: "k",
      dispatchId: "d",
    });

    const res = await POST(
      makeRequest({ mode: "custom", prompt: "do the thing" }),
      { params: Promise.resolve({ slug: "alpha" }) }
    );
    expect(res.status).toBe(200);

    expect(generatePromptMock).toHaveBeenCalledWith(
      fakeProject.path,
      "custom",
      "do the thing"
    );

    expect(dispatchClaudeMock).toHaveBeenCalledTimes(1);
    const [, projectArg, promptArg, optsArg] = dispatchClaudeMock.mock
      .calls[0] as unknown as [
      unknown,
      typeof fakeProject,
      string,
      { mode: string; customPrompt?: string; healthAtDispatch?: string }
    ];
    expect(projectArg.slug).toBe("alpha");
    expect(promptArg).toBe("test prompt");
    expect(optsArg).toMatchObject({
      mode: "custom",
      customPrompt: "do the thing",
      healthAtDispatch: fakeProject.health,
    });
  });
});
