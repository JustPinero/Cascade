import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    // Phase 37 — the legacy (key-less) release path looks up the
    // newest in-flight Dispatch row for the slug.
    dispatch: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    activityEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    dispatchOutcome: {
      create: vi.fn().mockResolvedValue({}),
    },
    humanTask: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("@/lib/project-import", () => ({
  importSingleProject: vi.fn().mockResolvedValue({
    name: "test",
    slug: "test",
    action: "updated",
  }),
}));

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/escalation-detector", () => ({
  detectEscalations: vi.fn().mockReturnValue([]),
}));

import { POST } from "./route";
import {
  getDispatchQueue,
  __resetDispatchQueueForTests,
} from "@/lib/dispatch-queue";

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

describe("session-complete webhook — dispatch queue release", () => {
  beforeEach(() => {
    __resetDispatchQueueForTests();
    vi.clearAllMocks();
  });

  it("releases the queue slot for the completed project", async () => {
    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "release");

    const response = await POST(makeRequest({ projectPath: "/p/some-project" }));
    const body = await response.json();

    expect(body.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith("/p/some-project");
  });

  it("does not release when projectPath is missing", async () => {
    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "release");

    const response = await POST(makeRequest({}));
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
