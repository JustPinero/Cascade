import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  default: { readFile: vi.fn() },
  readFile: vi.fn(),
}));

import { playbookTool } from "@/lib/overseer-tools-playbook";
import fs from "fs/promises";
import type { ToolContext } from "@/lib/overseer-tools";

function ctx(): ToolContext {
  return { prisma: {} as ToolContext["prisma"] };
}

const SAMPLE = `# Overseer Playbook

Some preamble text.

## Rules
- Always use first person.
- Be concise.
- Surface blockers before healthy projects.

## Notes
Some non-bullet content.
`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("playbookTool", () => {
  it("returns full content by default", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(SAMPLE);
    const out = await playbookTool.handler({}, ctx());
    expect(out.found).toBe(true);
    expect(out.content).toBe(SAMPLE);
  });

  it("returns just bullet lines when bullets:true", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(SAMPLE);
    const out = await playbookTool.handler({ bullets: true }, ctx());
    expect(out.found).toBe(true);
    expect(out.content).toBe(
      "- Always use first person.\n- Be concise.\n- Surface blockers before healthy projects."
    );
  });

  it("returns found:false on read error", async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error("ENOENT"));
    const out = await playbookTool.handler({}, ctx());
    expect(out).toEqual({ found: false, content: "" });
  });
});
