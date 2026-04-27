import path from "path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  DETECTOR_REGISTRY,
  loadDetectorInput,
  type DetectorInput,
} from "./anthropic-feature-detectors";
import { loadCatalogFromMd, syncCatalogToDb } from "./anthropic-features-md";

/**
 * Audit driver: connects detectors, the DB-backed feature catalog,
 * and the per-project usage ledger. Phase 11.1 — read-only against
 * project files; never modifies a project, just records what's
 * present.
 */

export interface AuditProjectResult {
  projectId: number;
  projectPath: string;
  detected: { featureName: string; signal: string }[];
  removed: number; // number of stale ProjectFeatureUsage rows dropped
  skippedFeatures: string[]; // features whose detector wasn't in the registry
}

export interface AuditAllResult {
  totalProjects: number;
  perProject: AuditProjectResult[];
}

/**
 * Audit a single project by id. Updates ProjectFeatureUsage for that
 * project to reflect current state on disk.
 */
export async function auditProjectFeatureUsage(
  prisma: PrismaClient,
  projectId: number,
  inputOverride?: DetectorInput,
): Promise<AuditProjectResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const input = inputOverride ?? (await loadDetectorInput(project.path));

  // Pull every feature that has a detector configured. Features with
  // detector=null (not yet implementable) are simply skipped — they can
  // still live in the catalog but won't appear in the ledger.
  const features = await prisma.upstreamFeature.findMany({
    where: { detector: { not: null } },
  });

  const detectedRows: { featureName: string; signal: string; featureId: number }[] = [];
  const skipped: string[] = [];

  for (const feature of features) {
    const detectorName = feature.detector!;
    const fn = DETECTOR_REGISTRY[detectorName];
    if (!fn) {
      skipped.push(`${feature.name} (detector "${detectorName}" not in registry)`);
      continue;
    }
    const result = fn(input);
    if (result.detected) {
      detectedRows.push({
        featureName: feature.name,
        featureId: feature.id,
        signal: result.signal,
      });
    }
  }

  // Upsert detected rows.
  for (const row of detectedRows) {
    await prisma.projectFeatureUsage.upsert({
      where: {
        projectId_featureId: { projectId, featureId: row.featureId },
      },
      create: {
        projectId,
        featureId: row.featureId,
        signal: row.signal,
      },
      update: {
        signal: row.signal,
        detectedAt: new Date(),
      },
    });
  }

  // Drop stale rows — features no longer detected for this project.
  const detectedFeatureIds = new Set(detectedRows.map((r) => r.featureId));
  const existing = await prisma.projectFeatureUsage.findMany({
    where: { projectId },
    select: { id: true, featureId: true },
  });
  const staleIds = existing
    .filter((e) => !detectedFeatureIds.has(e.featureId))
    .map((e) => e.id);
  let removed = 0;
  if (staleIds.length > 0) {
    const result = await prisma.projectFeatureUsage.deleteMany({
      where: { id: { in: staleIds } },
    });
    removed = result.count;
  }

  return {
    projectId,
    projectPath: project.path,
    detected: detectedRows.map((r) => ({
      featureName: r.featureName,
      signal: r.signal,
    })),
    removed,
    skippedFeatures: skipped,
  };
}

/**
 * Audit every project in the DB. Cascade itself is just a row in the
 * Project table (when registered) and gets the same treatment as any
 * managed project.
 */
export async function auditAllProjects(
  prisma: PrismaClient,
): Promise<AuditAllResult> {
  const projects = await prisma.project.findMany({
    select: { id: true },
  });
  const perProject: AuditProjectResult[] = [];
  for (const p of projects) {
    try {
      perProject.push(await auditProjectFeatureUsage(prisma, p.id));
    } catch (error) {
      // Best-effort: never let one project's failure stop the rest.
      console.error(
        JSON.stringify({
          event: "audit_project_failed",
          projectId: p.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return { totalProjects: projects.length, perProject };
}

/**
 * Bootstrap the catalog from the seed file.
 *
 * Reads knowledge/anthropic-features.md, parses it, and syncs into
 * the UpstreamFeature table. Idempotent — same file content produces
 * zero writes after the first run.
 *
 * Designed to be called from prisma/seed.ts and from the slash
 * command's "refresh from catalog" path.
 */
export async function syncSeedCatalog(
  prisma: PrismaClient,
  cascadeRoot: string = process.cwd(),
): Promise<{ added: number; updated: number; unchanged: number; total: number }> {
  const seedPath = path.join(cascadeRoot, "knowledge", "anthropic-features.md");
  const features = await loadCatalogFromMd(seedPath);
  const result = await syncCatalogToDb(prisma, features);
  return { ...result, total: features.length };
}

// ---------------------------------------------------------------------------
// Web fetch + Claude conversion (net-new candidate discovery)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIDENCE_THRESHOLD = 60;
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

const CONVERSION_SYSTEM_PROMPT = `You are a feature-catalog converter for an AI-orchestration tool called Cascade. Given raw text from an Anthropic doc / blog / release note, identify features (hooks, skills, slash commands, MCP servers, sub-agents, agent teams, settings flags, SDK / API capabilities, memory features, etc.) that a Claude Code project might adopt.

Return ONLY valid JSON (no markdown, no code fences) of the shape:
{
  "candidates": [
    {
      "name": "<short, distinct name>",
      "category": "hook | skill | slash-command | mcp-server | sub-agent | agent-team | settings-flag | sdk-feature | api-feature | memory | other",
      "description": "<2-3 sentences>",
      "integrationRecipe": "<concrete steps to adopt, ≤300 words>",
      "confidence": <integer 0-100>
    }
  ]
}

If the text describes no real feature, return {"candidates": []}.
Confidence < 60 means "I'm guessing." Reserve 80+ for clearly named, well-documented features.`;

export interface CandidatePayload {
  name: string;
  category: string;
  description: string;
  integrationRecipe: string;
  confidence: number;
}

export function parseCandidatesJson(raw: string): CandidatePayload[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { candidates?: unknown }).candidates)
  ) {
    return [];
  }
  const arr = (parsed as { candidates: unknown[] }).candidates;
  const out: CandidatePayload[] = [];
  for (const item of arr) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (
      typeof o.name !== "string" ||
      o.name.trim() === "" ||
      typeof o.category !== "string" ||
      !VALID_CATEGORIES.has(o.category) ||
      typeof o.description !== "string" ||
      typeof o.integrationRecipe !== "string" ||
      typeof o.confidence !== "number" ||
      !Number.isFinite(o.confidence)
    ) {
      continue;
    }
    out.push({
      name: o.name.trim(),
      category: o.category,
      description: o.description,
      integrationRecipe: o.integrationRecipe,
      confidence: Math.max(0, Math.min(100, Math.round(o.confidence))),
    });
  }
  return out;
}

/** Conservative fuzzy dedup: lowercased + trimmed name match. */
export function isDuplicateName(
  candidate: string,
  existingNames: string[],
): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s.()]+$/g, "");
  const c = norm(candidate);
  if (c === "") return false;
  for (const ex of existingNames) {
    if (norm(ex) === c) return true;
  }
  return false;
}

export interface RunFeatureCheckDeps {
  cascadeRoot?: string;
  fetchImpl?: typeof globalThis.fetch;
  convertImpl?: (rawText: string) => Promise<string>;
  confidenceThreshold?: number;
  envSources?: string;
}

export interface FetchedSourceReport {
  url: string;
  status: "ok" | "skipped" | "error";
  reason?: string;
  candidateCount?: number;
}

export interface FeatureCheckReport {
  catalogSync: { added: number; updated: number; unchanged: number; total: number };
  newCandidates: CandidatePayload[];
  droppedLowConfidence: CandidatePayload[];
  fetchedSources: FetchedSourceReport[];
  usage: AuditAllResult;
}

async function defaultClaudeConversion(rawText: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: CONVERSION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: rawText.slice(0, 30_000) }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }
    const data = (await response.json()) as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? "{}";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * On-demand audit + discovery flow triggered by the slash command.
 *
 * 1. Sync the seed catalog (idempotent).
 * 2. For each configured source URL, fetch + convert via Claude → candidates.
 * 3. Filter: confidence ≥ threshold AND not a duplicate of existing catalog entry.
 * 4. Audit every project to refresh the ledger.
 *
 * Never auto-adds candidates. The user reviews them out-of-band.
 */
export async function runFeatureCheck(
  prisma: PrismaClient,
  deps: RunFeatureCheckDeps = {},
): Promise<FeatureCheckReport> {
  const cascadeRoot = deps.cascadeRoot ?? process.cwd();
  const threshold = deps.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const sources = (
    deps.envSources ??
    process.env.ANTHROPIC_FEATURE_SOURCES ??
    ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const convert = deps.convertImpl ?? defaultClaudeConversion;

  const catalogSync = await syncSeedCatalog(prisma, cascadeRoot);

  const existingFeatures = await prisma.upstreamFeature.findMany({
    select: { name: true, vendor: true },
  });
  const existingAnthropicNames = existingFeatures
    .filter((f) => f.vendor === "anthropic")
    .map((f) => f.name);

  const fetchedSources: FetchedSourceReport[] = [];
  const allCandidates: CandidatePayload[] = [];

  for (const url of sources) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) {
        fetchedSources.push({
          url,
          status: "error",
          reason: `HTTP ${response.status}`,
        });
        continue;
      }
      const text = await response.text();
      const claudeOut = await convert(text);
      const candidates = parseCandidatesJson(claudeOut);
      allCandidates.push(...candidates);
      fetchedSources.push({ url, status: "ok", candidateCount: candidates.length });
    } catch (error) {
      fetchedSources.push({
        url,
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const newCandidates: CandidatePayload[] = [];
  const droppedLowConfidence: CandidatePayload[] = [];
  for (const c of allCandidates) {
    if (isDuplicateName(c.name, existingAnthropicNames)) continue;
    if (c.confidence < threshold) droppedLowConfidence.push(c);
    else newCandidates.push(c);
  }

  const usage = await auditAllProjects(prisma);

  return {
    catalogSync,
    newCandidates,
    droppedLowConfidence,
    fetchedSources,
    usage,
  };
}

/**
 * Render a FeatureCheckReport into Markdown for the Overseer chat
 * response. Designed to be readable both as streamed text and as
 * static documentation.
 */
export function renderFeatureCheckReport(report: FeatureCheckReport): string {
  const lines: string[] = [];
  lines.push("# Anthropic Feature Update Check\n");

  const cs = report.catalogSync;
  lines.push("## Catalog\n");
  lines.push(`- Total features in catalog: **${cs.total}**`);
  lines.push(
    `- Added this run: ${cs.added} · Updated: ${cs.updated} · Unchanged: ${cs.unchanged}\n`,
  );

  lines.push("## Upstream sources fetched\n");
  if (report.fetchedSources.length === 0) {
    lines.push("_No sources configured (set `ANTHROPIC_FEATURE_SOURCES` env var)._\n");
  } else {
    for (const s of report.fetchedSources) {
      const note =
        s.status === "ok"
          ? `${s.candidateCount ?? 0} candidate${s.candidateCount === 1 ? "" : "s"}`
          : s.reason ?? "";
      lines.push(`- **${s.url}** — ${s.status}${note ? ` (${note})` : ""}`);
    }
    lines.push("");
  }

  lines.push("## New candidates for review\n");
  if (report.newCandidates.length === 0) {
    lines.push("_None this run._\n");
  } else {
    for (const c of report.newCandidates) {
      lines.push(`### ${c.name}`);
      lines.push(`- **Category:** ${c.category}`);
      lines.push(`- **Confidence:** ${c.confidence}`);
      lines.push(`- ${c.description}`);
      lines.push(`- Integration: ${c.integrationRecipe}`);
      lines.push("");
    }
  }

  if (report.droppedLowConfidence.length > 0) {
    lines.push("## Dropped (low confidence)\n");
    for (const c of report.droppedLowConfidence) {
      lines.push(`- ${c.name} (confidence ${c.confidence}, ${c.category})`);
    }
    lines.push("");
  }

  lines.push("## Project feature-usage ledger\n");
  if (report.usage.totalProjects === 0) {
    lines.push("_No projects registered yet._\n");
  } else {
    lines.push(
      `Audited ${report.usage.totalProjects} project${report.usage.totalProjects === 1 ? "" : "s"}.\n`,
    );
    for (const pp of report.usage.perProject) {
      lines.push(`### ${pp.projectPath}`);
      if (pp.detected.length === 0) {
        lines.push("- _no features detected_");
      } else {
        for (const d of pp.detected) {
          lines.push(`- ${d.featureName} — ${d.signal}`);
        }
      }
      if (pp.removed > 0) {
        lines.push(
          `- _(${pp.removed} stale row${pp.removed === 1 ? "" : "s"} pruned)_`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Detect whether the latest user message in a chat invokes the
 * /anthropic-feature-update-check slash command. Case-insensitive;
 * tolerates leading whitespace.
 */
export function isFeatureCheckCommand(messageText: string): boolean {
  return /^\s*\/anthropic-feature-update-check\b/i.test(messageText);
}
