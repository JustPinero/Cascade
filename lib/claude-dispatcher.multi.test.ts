import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ""),
    existsSync: vi.fn(() => true),
  },
}));

vi.mock("fs/promises", () => {
  const api = {
    access: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ""),
    readdir: vi.fn(async () => []),
    rm: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { default: api, ...api };
});

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
  execFileSync: vi.fn(() => Buffer.from("")),
}));

vi.mock("./file-utils", () => ({
  readIfExists: vi.fn(async () => "content"),
}));

vi.mock("./validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
  sanitizeForShell: vi.fn((s: string) => s),
}));

import {
  dispatchAll,
  dispatchBatch,
  dispatchTeam,
} from "./claude-dispatcher";
import {
  getDispatchQueue,
  __resetDispatchQueueForTests,
} from "./dispatch-queue";

interface MockPrisma {
  project: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  activityEvent: {
    create: ReturnType<typeof vi.fn>;
  };
}

function makeMockPrisma(): MockPrisma {
  return {
    project: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    activityEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

type DispatcherPrisma = Parameters<typeof dispatchAll>[0];

describe("multi-project dispatch — queue integration", () => {
  beforeEach(() => {
    __resetDispatchQueueForTests();
    vi.clearAllMocks();
  });

  it("dispatchAll enqueues one job per ready project", async () => {
    const mockPrisma = makeMockPrisma();
    mockPrisma.project.findMany.mockResolvedValue([
      { id: 1, name: "Alpha", slug: "alpha", path: "/p/alpha", status: "building" },
      { id: 2, name: "Beta", slug: "beta", path: "/p/beta", status: "building" },
      { id: 3, name: "Gamma", slug: "gamma", path: "/p/gamma", status: "building" },
    ]);

    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "enqueue");

    await dispatchAll(mockPrisma as unknown as DispatcherPrisma, "continue");

    expect(spy).toHaveBeenCalledTimes(3);
    const ids = spy.mock.calls.map((c) => c[0].id);
    expect(ids).toEqual(["/p/alpha", "/p/beta", "/p/gamma"]);
  });

  it("dispatchBatch enqueues one job per specified item", async () => {
    const mockPrisma = makeMockPrisma();
    mockPrisma.project.findUnique.mockImplementation(
      async ({ where: { slug } }: { where: { slug: string } }) => ({
        id: 1,
        name: slug,
        slug,
        path: `/p/${slug}`,
        status: "building",
      })
    );

    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "enqueue");

    await dispatchBatch(mockPrisma as unknown as DispatcherPrisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "audit" },
    ]);

    expect(spy).toHaveBeenCalledTimes(2);
    const ids = spy.mock.calls.map((c) => c[0].id);
    expect(ids).toEqual(["/p/alpha", "/p/beta"]);
  });

  it("dispatchTeam enqueues exactly one lead-agent job", async () => {
    const mockPrisma = makeMockPrisma();
    mockPrisma.project.findUnique.mockImplementation(
      async ({ where: { slug } }: { where: { slug: string } }) => ({
        id: 1,
        name: slug,
        slug,
        path: `/p/${slug}`,
        status: "building",
      })
    );

    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "enqueue");

    await dispatchTeam(mockPrisma as unknown as DispatcherPrisma, [
      { slug: "alpha", mode: "continue" },
      { slug: "beta", mode: "continue" },
      { slug: "gamma", mode: "continue" },
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
