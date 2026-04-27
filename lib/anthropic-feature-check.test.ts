import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import {
  parseCandidatesJson,
  isDuplicateName,
  runFeatureCheck,
} from "@/lib/anthropic-feature-check";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-feature-check.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

describe("parseCandidatesJson", () => {
  it("returns empty array on non-JSON input", () => {
    expect(parseCandidatesJson("not json at all")).toEqual([]);
  });

  it("returns empty array when candidates field is missing", () => {
    expect(parseCandidatesJson('{"foo": []}')).toEqual([]);
  });

  it("filters out malformed candidate objects", () => {
    const input = JSON.stringify({
      candidates: [
        { name: "", category: "hook", description: "x", integrationRecipe: "y", confidence: 90 },
        { name: "Real", category: "fake-category", description: "x", integrationRecipe: "y", confidence: 90 },
        { name: "Real Hook", category: "hook", description: "x", integrationRecipe: "y", confidence: 85 },
      ],
    });
    const out = parseCandidatesJson(input);
    expect(out.length).toBe(1);
    expect(out[0].name).toBe("Real Hook");
  });

  it("clamps confidence to [0, 100]", () => {
    const input = JSON.stringify({
      candidates: [
        { name: "A", category: "hook", description: "d", integrationRecipe: "r", confidence: 200 },
        { name: "B", category: "hook", description: "d", integrationRecipe: "r", confidence: -50 },
      ],
    });
    const out = parseCandidatesJson(input);
    expect(out[0].confidence).toBe(100);
    expect(out[1].confidence).toBe(0);
  });
});

describe("isDuplicateName", () => {
  it("matches exact lowercase", () => {
    expect(isDuplicateName("Stop Hook", ["stop hook"])).toBe(true);
  });

  it("does not match different names", () => {
    expect(isDuplicateName("Stop Hook", ["Skills", "Plan Mode"])).toBe(false);
  });

  it("returns false for empty candidate", () => {
    expect(isDuplicateName("   ", ["X"])).toBe(false);
  });

  it("strips trailing punctuation/whitespace before comparing", () => {
    expect(isDuplicateName("Stop Hook.", ["Stop Hook"])).toBe(true);
  });
});

describe("runFeatureCheck (integration)", () => {
  it("seeds the catalog and returns a report shape with no sources configured", async () => {
    const cascadeRoot = path.resolve(__dirname, "..");
    const report = await runFeatureCheck(prisma, {
      cascadeRoot,
      envSources: "", // no URLs → skip fetch
    });

    expect(report.catalogSync.total).toBeGreaterThan(15); // seeded ~21 features
    expect(report.fetchedSources).toEqual([]);
    expect(report.newCandidates).toEqual([]);
    expect(report.droppedLowConfidence).toEqual([]);
    expect(report.usage.totalProjects).toBe(0); // no projects in this test DB
  });

  it("calls fetchImpl + convertImpl for configured sources", async () => {
    const cascadeRoot = path.resolve(__dirname, "..");
    let fetchedUrl = "";
    let conversionInput = "";
    const fetchImpl = (async (url: string | URL | Request) => {
      fetchedUrl = String(url);
      return new Response("RAW DOCS TEXT", { status: 200 });
    }) as typeof globalThis.fetch;
    const convertImpl = async (raw: string) => {
      conversionInput = raw;
      return JSON.stringify({
        candidates: [
          {
            name: "Brand New Feature",
            category: "hook",
            description: "Something new",
            integrationRecipe: "Add to settings",
            confidence: 90,
          },
        ],
      });
    };

    const report = await runFeatureCheck(prisma, {
      cascadeRoot,
      envSources: "https://example.com/changelog",
      fetchImpl,
      convertImpl,
    });

    expect(fetchedUrl).toBe("https://example.com/changelog");
    expect(conversionInput).toBe("RAW DOCS TEXT");
    expect(report.fetchedSources[0]).toMatchObject({
      url: "https://example.com/changelog",
      status: "ok",
      candidateCount: 1,
    });
    expect(report.newCandidates.length).toBe(1);
    expect(report.newCandidates[0].name).toBe("Brand New Feature");
  });

  it("filters low-confidence candidates", async () => {
    const cascadeRoot = path.resolve(__dirname, "..");
    const fetchImpl = (async () =>
      new Response("text", { status: 200 })) as typeof globalThis.fetch;
    const convertImpl = async () =>
      JSON.stringify({
        candidates: [
          {
            name: "Low Confidence Thing",
            category: "other",
            description: "?",
            integrationRecipe: "?",
            confidence: 30,
          },
          {
            name: "High Confidence Thing",
            category: "hook",
            description: "?",
            integrationRecipe: "?",
            confidence: 95,
          },
        ],
      });

    const report = await runFeatureCheck(prisma, {
      cascadeRoot,
      envSources: "https://example.com/x",
      fetchImpl,
      convertImpl,
      confidenceThreshold: 60,
    });

    expect(report.newCandidates.map((c) => c.name)).toEqual(["High Confidence Thing"]);
    expect(report.droppedLowConfidence.map((c) => c.name)).toEqual(["Low Confidence Thing"]);
  });

  it("dedupes candidates against existing catalog entries", async () => {
    const cascadeRoot = path.resolve(__dirname, "..");
    const fetchImpl = (async () =>
      new Response("text", { status: 200 })) as typeof globalThis.fetch;
    const convertImpl = async () =>
      JSON.stringify({
        candidates: [
          {
            name: "Stop Hook",
            category: "hook",
            description: "dup",
            integrationRecipe: "dup",
            confidence: 95,
          },
        ],
      });

    const report = await runFeatureCheck(prisma, {
      cascadeRoot,
      envSources: "https://example.com/x",
      fetchImpl,
      convertImpl,
    });

    expect(report.newCandidates.length).toBe(0);
  });

  it("records error status for HTTP-failing sources", async () => {
    const cascadeRoot = path.resolve(__dirname, "..");
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as typeof globalThis.fetch;
    const report = await runFeatureCheck(prisma, {
      cascadeRoot,
      envSources: "https://example.com/down",
      fetchImpl,
    });
    expect(report.fetchedSources[0].status).toBe("error");
    expect(report.fetchedSources[0].reason).toContain("503");
  });
});
