import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import {
  parseAnthropicFeaturesMd,
  syncCatalogToDb,
  loadCatalogFromMd,
} from "@/lib/anthropic-features-md";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-features-md.db");
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

const SAMPLE = `# Anthropic Feature Catalog (Seed)

Some preamble text.

## Entry schema

This is a documentation section, not a feature. It has no Vendor field.

\`\`\`
example
\`\`\`

---

## Stop Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsStopHook

A Claude Code hook that fires when a session ends.

**Integration recipe**: install via the install-hooks script.

## Skills
- **Vendor**: anthropic
- **Category**: skill
- **Source**: manual
- **Confidence**: 100
- **Detector**: none

User-defined skills stored as Markdown files.

**Integration recipe**: drop a SKILL.md with frontmatter.

## Bogus Category Feature
- **Vendor**: anthropic
- **Category**: not-a-real-category
- **Source**: manual
- **Confidence**: 100
- **Detector**: none

Should be skipped.

**Integration recipe**: n/a.
`;

describe("parseAnthropicFeaturesMd", () => {
  it("returns one entry per real feature block", () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    expect(features.length).toBe(2);
    expect(features.map((f) => f.name)).toEqual(["Stop Hook", "Skills"]);
  });

  it("skips ## blocks without a **Vendor** field (docs)", () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    expect(features.find((f) => f.name === "Entry schema")).toBeUndefined();
  });

  it("skips entries with an invalid category", () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    expect(features.find((f) => f.name === "Bogus Category Feature")).toBeUndefined();
  });

  it("parses vendor, category, source, confidence, detector", () => {
    const [stopHook] = parseAnthropicFeaturesMd(SAMPLE);
    expect(stopHook.vendor).toBe("anthropic");
    expect(stopHook.category).toBe("hook");
    expect(stopHook.source).toBe("manual");
    expect(stopHook.confidence).toBe(100);
    expect(stopHook.detector).toBe("detectsStopHook");
  });

  it('treats detector "none" as null', () => {
    const skills = parseAnthropicFeaturesMd(SAMPLE).find(
      (f) => f.name === "Skills"
    );
    expect(skills!.detector).toBeNull();
  });

  it("splits description from integration recipe", () => {
    const [stopHook] = parseAnthropicFeaturesMd(SAMPLE);
    expect(stopHook.description).toContain("Claude Code hook");
    expect(stopHook.description).not.toContain("Integration recipe");
    expect(stopHook.integrationRecipe).toContain("install-hooks");
  });

  it("returns empty integrationRecipe if section is missing", () => {
    const minimal = `## Lone Feature
- **Vendor**: anthropic
- **Category**: other
- **Source**: manual
- **Confidence**: 100
- **Detector**: none

Just a description, no recipe.
`;
    const [feature] = parseAnthropicFeaturesMd(minimal);
    expect(feature.description).toContain("Just a description");
    expect(feature.integrationRecipe).toBe("");
  });

  it("defaults confidence to 100 when missing or unparseable", () => {
    const minimal = `## Lone Feature
- **Vendor**: anthropic
- **Category**: other
- **Source**: manual
- **Detector**: none

desc
`;
    const [feature] = parseAnthropicFeaturesMd(minimal);
    expect(feature.confidence).toBe(100);
  });
});

describe("loadCatalogFromMd (real seed file)", () => {
  it("parses knowledge/anthropic-features.md without throwing", async () => {
    const seedPath = path.resolve(__dirname, "..", "knowledge", "anthropic-features.md");
    const features = await loadCatalogFromMd(seedPath);
    expect(features.length).toBeGreaterThanOrEqual(15);
    // Every entry has a non-empty name and category
    for (const f of features) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.category.length).toBeGreaterThan(0);
    }
  });

  it("includes Stop Hook in the seed", async () => {
    const seedPath = path.resolve(__dirname, "..", "knowledge", "anthropic-features.md");
    const features = await loadCatalogFromMd(seedPath);
    expect(features.find((f) => f.name === "Stop Hook")).toBeDefined();
  });
});

describe("syncCatalogToDb", () => {
  it("adds new features on first run", async () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    const result = await syncCatalogToDb(prisma, features);
    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(0);
  });

  it("is idempotent — second run reports all unchanged", async () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    const result = await syncCatalogToDb(prisma, features);
    expect(result.added).toBe(0);
    expect(result.unchanged).toBe(2);
  });

  it("updates an existing feature when content changes", async () => {
    const features = parseAnthropicFeaturesMd(SAMPLE);
    features[0].description = "An updated description.";
    const result = await syncCatalogToDb(prisma, features);
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);

    const row = await prisma.upstreamFeature.findUnique({
      where: { vendor_name: { vendor: "anthropic", name: "Stop Hook" } },
    });
    expect(row!.description).toBe("An updated description.");
  });
});
