import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/project-launcher", () => ({
  launchProject: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

import { POST } from "./route";
import { launchProject } from "@/lib/project-launcher";
import { NextRequest } from "next/server";

const mocked = vi.mocked(launchProject);

function makeRequest(body: unknown, opts?: { raw?: string }): NextRequest {
  return new NextRequest("http://localhost:3000/api/projects/launch", {
    method: "POST",
    body: opts?.raw ?? JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mocked.mockReset();
});

describe("POST /api/projects/launch", () => {
  it("returns 400 when name is missing", async () => {
    const res = await POST(
      makeRequest({ slug: "foo", kickoffContent: "do stuff" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name, slug, and kickoffContent/);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("returns 400 when slug is missing", async () => {
    const res = await POST(
      makeRequest({ name: "Foo", kickoffContent: "do stuff" })
    );
    expect(res.status).toBe(400);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("returns 400 when kickoffContent is missing", async () => {
    const res = await POST(makeRequest({ name: "Foo", slug: "foo" }));
    expect(res.status).toBe(400);
    expect(mocked).not.toHaveBeenCalled();
  });

  it("returns 201 on happy path and applies all defaults", async () => {
    mocked.mockResolvedValue({
      success: true,
      project: { id: "p1", slug: "foo" },
    } as unknown as Awaited<ReturnType<typeof launchProject>>);

    const res = await POST(
      makeRequest({
        name: "Foo",
        slug: "foo",
        kickoffContent: "build a thing",
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);

    expect(mocked).toHaveBeenCalledTimes(1);
    const [, , options] = mocked.mock.calls[0];
    expect(options).toMatchObject({
      name: "Foo",
      slug: "foo",
      kickoffContent: "build a thing",
      projectType: "web-app",
      createGithubRepo: false,
      isPrivate: true,
      autonomyMode: "semi",
      agentTeamsEnabled: false,
      prWorkflowEnabled: false,
    });
  });

  it("passes through caller-supplied options instead of defaults", async () => {
    mocked.mockResolvedValue({
      success: true,
      project: { id: "p2", slug: "bar" },
    } as unknown as Awaited<ReturnType<typeof launchProject>>);

    await POST(
      makeRequest({
        name: "Bar",
        slug: "bar",
        kickoffContent: "kick",
        projectType: "cli-tool",
        createGithubRepo: true,
        isPrivate: false,
        autonomyMode: "full",
        agentTeamsEnabled: true,
        prWorkflowEnabled: true,
      })
    );

    const [, , options] = mocked.mock.calls[0];
    expect(options).toMatchObject({
      projectType: "cli-tool",
      createGithubRepo: true,
      isPrivate: false,
      autonomyMode: "full",
      agentTeamsEnabled: true,
      prWorkflowEnabled: true,
    });
  });

  it("returns 500 when launchProject returns success:false", async () => {
    mocked.mockResolvedValue({
      success: false,
      error: "disk full",
    } as unknown as Awaited<ReturnType<typeof launchProject>>);

    const res = await POST(
      makeRequest({
        name: "Foo",
        slug: "foo",
        kickoffContent: "build a thing",
      })
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("disk full");
  });

  it("returns 500 on unhandled exception (malformed JSON body)", async () => {
    const res = await POST(makeRequest(null, { raw: "{not json" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
    expect(mocked).not.toHaveBeenCalled();
  });
});
