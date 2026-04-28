import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/engineer-channel", () => ({
  readChannelContent: vi.fn(),
}));

import { engineerMessagesTool } from "@/lib/overseer-tools-engineer-messages";
import { readChannelContent } from "@/lib/engineer-channel";
import type { ToolContext } from "@/lib/overseer-tools";

function ctx(): ToolContext {
  return { prisma: {} as ToolContext["prisma"] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("engineerMessagesTool", () => {
  it("returns the channel content (truncated to maxChars from the end)", async () => {
    vi.mocked(readChannelContent).mockResolvedValueOnce("a".repeat(3000) + "TAIL");
    const out = await engineerMessagesTool.handler({ maxChars: 100 }, ctx());
    expect(out.found).toBe(true);
    expect(out.content.endsWith("TAIL")).toBe(true);
    expect(out.content.length).toBe(100);
  });

  it("defaults to last 2000 chars", async () => {
    vi.mocked(readChannelContent).mockResolvedValueOnce("x".repeat(5000));
    const out = await engineerMessagesTool.handler({}, ctx());
    expect(out.content.length).toBe(2000);
  });

  it("returns found:false on empty channel", async () => {
    vi.mocked(readChannelContent).mockResolvedValueOnce("");
    const out = await engineerMessagesTool.handler({}, ctx());
    expect(out).toEqual({ found: false, content: "" });
  });

  it("returns found:false on read error", async () => {
    vi.mocked(readChannelContent).mockRejectedValueOnce(new Error("ENOENT"));
    const out = await engineerMessagesTool.handler({}, ctx());
    expect(out).toEqual({ found: false, content: "" });
  });
});
