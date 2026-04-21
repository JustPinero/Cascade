import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: {
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => ""),
  },
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execSync: vi.fn(() => Buffer.from("")),
}));

vi.mock("./validators", () => ({
  isInsideProjectsDir: vi.fn(() => true),
}));

import { dispatchClaude } from "./claude-dispatcher";
import {
  getDispatchQueue,
  __resetDispatchQueueForTests,
} from "./dispatch-queue";
import { isInsideProjectsDir } from "./validators";

describe("dispatchClaude — queue integration", () => {
  beforeEach(() => {
    __resetDispatchQueueForTests();
    vi.clearAllMocks();
    vi.mocked(isInsideProjectsDir).mockReturnValue(true);
  });

  it("routes through the singleton dispatch queue with projectPath as id", async () => {
    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "enqueue");

    const result = await dispatchClaude("/some/project/path", "prompt text");

    expect(spy).toHaveBeenCalledTimes(1);
    const job = spy.mock.calls[0][0];
    expect(job.id).toBe("/some/project/path");
    expect(typeof job.dispatch).toBe("function");
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it("returns failure without enqueueing when path is outside projects dir", async () => {
    vi.mocked(isInsideProjectsDir).mockReturnValueOnce(false);

    const queue = getDispatchQueue();
    const spy = vi.spyOn(queue, "enqueue");

    const result = await dispatchClaude("/outside", "prompt");

    expect(spy).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid project path/);
  });
});
