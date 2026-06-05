import fs from "fs/promises";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Parsed shape of one feature block from knowledge/anthropic-features.md.
 * Mirrors the columns of the UpstreamFeature Prisma model — both the
 * harvester (low-confidence candidates) and the curated seed produce
 * objects of this shape.
 */
export interface ParsedFeature {
  name: string;
  vendor: string;
  category: string;
  source: string;
  confidence: number;
  detector: string | null;
  description: string;
  integrationRecipe: string;
}

const VALID_CATEGORIES = new Set([
  "hook",
  "skill",
  "slash-command",
  "mcp-server",
  "sub-agent",
  "agent-team",
  "settings-flag",
  "sdk-feature",
  "api-feature",
  "memory",
  "other",
]);

/**
 * Parse the markdown catalog into ParsedFeature[].
 *
 * Each `## ` block is a candidate feature. A block is treated as a real
 * feature only if it declares a `**Vendor**` field — that filter
 * skips documentation sections (like "## Entry schema") that share the
 * same heading depth.
 *
 * Description is the prose between the field block and the
 * "**Integration recipe**:" marker; everything after that marker is the
 * integration recipe.
 */
export function parseAnthropicFeaturesMd(content: string): ParsedFeature[] {
  // Normalize CRLF → LF first. On Windows checkouts with autocrlf, the
  // file arrives with `\r\n` line terminators, which the field-block
  // regex (`(.*)$`) refuses to match because `.` doesn't consume `\r`
  // and `$` only anchors before `\n`/EOS. Without this, the parser
  // silently returns zero features on a Windows host. (Phase 27.)
  const normalized = content.replace(/\r\n/g, "\n");
  // Split by "^## " — the first chunk is the file preamble, drop it.
  const sections = normalized.split(/^## /m).slice(1);
  const features: ParsedFeature[] = [];

  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0]!.trim();
    if (!name) continue;

    // Walk past blank lines, then collect the field block.
    let i = 1;
    while (i < lines.length && lines[i].trim() === "") i++;

    const fields: Record<string, string> = {};
    while (i < lines.length) {
      const m = lines[i].match(/^\s*-\s+\*\*([^*]+)\*\*:\s*(.*)$/);
      if (!m) break;
      fields[m[1].trim().toLowerCase()] = m[2].trim();
      i++;
    }

    // No vendor field → not a real feature (likely a doc section).
    if (!fields.vendor) continue;

    // Validate category — drop entries with unknown categories so a
    // typo in the seed doesn't pollute the DB.
    const category = fields.category;
    if (!VALID_CATEGORIES.has(category)) continue;

    // The remaining content is description + integration recipe.
    const rest = lines.slice(i).join("\n").trim();
    const recipeMarker = "**Integration recipe**:";
    const recipeIdx = rest.indexOf(recipeMarker);
    let description = rest;
    let integrationRecipe = "";
    if (recipeIdx >= 0) {
      description = rest.slice(0, recipeIdx).trim();
      integrationRecipe = rest.slice(recipeIdx + recipeMarker.length).trim();
    }

    const confidenceParsed = parseInt(fields.confidence ?? "100", 10);
    const confidence = Number.isFinite(confidenceParsed) ? confidenceParsed : 100;

    const detectorRaw = (fields.detector ?? "").trim();
    const detector =
      detectorRaw === "" || detectorRaw.toLowerCase() === "none" ? null : detectorRaw;

    features.push({
      name,
      vendor: fields.vendor,
      category,
      source: fields.source || "manual",
      confidence,
      detector,
      description,
      integrationRecipe,
    });
  }

  return features;
}

export async function loadCatalogFromMd(filePath: string): Promise<ParsedFeature[]> {
  const content = await fs.readFile(filePath, "utf-8");
  return parseAnthropicFeaturesMd(content);
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Idempotent upsert of parsed features into the UpstreamFeature table.
 * - New (vendor, name) → INSERT
 * - Existing with identical content → no-op
 * - Existing with changed content → UPDATE
 *
 * The unique key is (vendor, name) per the Prisma schema.
 */
export async function syncCatalogToDb(
  prisma: PrismaClient,
  features: ParsedFeature[],
): Promise<SyncResult> {
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const f of features) {
    const existing = await prisma.upstreamFeature.findUnique({
      where: { vendor_name: { vendor: f.vendor, name: f.name } },
    });

    if (!existing) {
      await prisma.upstreamFeature.create({
        data: {
          vendor: f.vendor,
          name: f.name,
          category: f.category,
          description: f.description,
          integrationRecipe: f.integrationRecipe,
          source: f.source,
          confidence: f.confidence,
          detector: f.detector,
        },
      });
      added++;
      continue;
    }

    const same =
      existing.category === f.category &&
      existing.description === f.description &&
      existing.integrationRecipe === f.integrationRecipe &&
      existing.source === f.source &&
      existing.confidence === f.confidence &&
      existing.detector === f.detector;

    if (same) {
      unchanged++;
    } else {
      await prisma.upstreamFeature.update({
        where: { id: existing.id },
        data: {
          category: f.category,
          description: f.description,
          integrationRecipe: f.integrationRecipe,
          source: f.source,
          confidence: f.confidence,
          detector: f.detector,
        },
      });
      updated++;
    }
  }

  return { added, updated, unchanged };
}
