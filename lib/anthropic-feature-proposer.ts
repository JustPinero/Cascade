import fs from "fs/promises";
import path from "path";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Phase 11.2 — feature proposer.
 *
 * Builds on 11.1's catalog (`UpstreamFeature`) and ledger
 * (`ProjectFeatureUsage`). For each project × known-feature gap,
 * calls Claude with the feature's `integrationRecipe` plus the
 * project's CLAUDE.md / .claude/settings.json snippets, and asks for
 * a concrete file-by-file diff describing how to adopt the feature.
 *
 * Phase 11.2 is intentionally human-gated. Proposals are rendered
 * back to the Overseer chat as Markdown. The user reviews each one
 * and applies manually. NEVER auto-applies. NEVER writes into the
 * managed project's source tree (the only thing 11.x writes into a
 * project is the existing advisory engine's
 * `.claude/nerve-center-advisory.md`).
 *
 * Persistence of proposals (acceptance / rejection / outcomes) is
 * deferred to 11.3 if needed.
 */

// ----------------------------------------------------------------------------
// Gap detection
// ----------------------------------------------------------------------------

export interface FeatureGap {
  featureId: number;
  featureName: string;
  category: string;
  description: string;
  integrationRecipe: string;
}

/**
 * Find features that have a detector but are NOT detected as in use
 * for this project. Features with `detector === null` are skipped —
 * we can't know if a project uses them, so we can't propose adopting
 * them either.
 */
export async function findGapsForProject(
  prisma: PrismaClient,
  projectId: number,
): Promise<FeatureGap[]> {
  const [allFeatures, usages] = await Promise.all([
    prisma.upstreamFeature.findMany({ where: { detector: { not: null } } }),
    prisma.projectFeatureUsage.findMany({
      where: { projectId },
      select: { featureId: true },
    }),
  ]);
  const used = new Set(usages.map((u) => u.featureId));
  return allFeatures
    .filter((f) => !used.has(f.id))
    .map((f) => ({
      featureId: f.id,
      featureName: f.name,
      category: f.category,
      description: f.description,
      integrationRecipe: f.integrationRecipe,
    }));
}

// ----------------------------------------------------------------------------
// Claude-driven proposal generation
// ----------------------------------------------------------------------------

const PROPOSAL_SYSTEM_PROMPT = `You are an integration-diff generator for Cascade. Given:

1. A target project (with its CLAUDE.md and .claude/settings.json contents).
2. An upstream Anthropic / Claude Code feature the project does NOT yet use.
3. The feature's integration recipe.

You produce a CONCRETE file-by-file diff describing how to adopt the
feature in this specific project. The diff should be reviewable by a
human and applicable by hand or by another Claude Code session.

Rules:
- Output MUST be Markdown.
- For each file you propose to modify or create, use a "### filename" header
  followed by a fenced code block showing the change. Use unified-diff style
  for modifications and a normal code block for new files.
- Stay concrete and tight: ≤ 50 lines of actual diff per file. If a recipe
  is bigger than that, summarize the rest in prose.
- If the project's existing CLAUDE.md or .claude/settings.json already
  conflicts with the recipe in a way the human should resolve, call that
  out under a "### Conflicts" header before any diffs.
- If the project genuinely doesn't need this feature (wrong stack, etc.),
  say so under "### Recommendation: skip" with a one-line reason and stop.
- Never invent project content you weren't shown. If you need information
  the user didn't provide, ask one short question under
  "### Need clarification" and stop.

Voice: terse, professional, action-oriented. No hedge language ("maybe
consider…"). State the change.`;

export interface GenerateProposalInput {
  feature: FeatureGap;
  projectName: string;
  projectPath: string;
  claudeMd: string;
  settingsJson: string;
}

export interface GenerateProposalDeps {
  /** Override Claude call. Default uses ANTHROPIC_API_KEY + raw fetch. */
  callClaude?: (system: string, user: string) => Promise<string>;
}

const DEFAULT_MAX_BYTES_PER_FILE = 4_000;

function truncateForPrompt(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return (
    text.slice(0, maxBytes) +
    `\n\n[…truncated, original was ${text.length} bytes]`
  );
}

async function defaultCallClaude(system: string, user: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const PROPOSER_MODEL = "claude-sonnet-4-6";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const start = performance.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: PROPOSER_MODEL,
        max_tokens: 2048,
        // Phase 23.4 — proposeForAll calls in bursts when several
        // feature gaps exist; 1h TTL covers a multi-feature audit.
        // Fallback to no caching if the system prompt is below the
        // 2,048-token Sonnet 4.6 minimum (telemetry will reveal this
        // post-deploy via /observability/cache).
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
      usage?: unknown;
    };
    // Phase 23.3 — usage telemetry. Lazy import to avoid pulling
    // prisma into modules that import this proposer for testing.
    const { logUsage } = await import("./anthropic-usage-log");
    const { prisma } = await import("./db");
    logUsage(prisma, {
      callSite: "feature-proposer",
      model: PROPOSER_MODEL,
      usage: data.usage as Parameters<typeof logUsage>[1]["usage"],
      durationMs: Math.round(performance.now() - start),
    });
    return data.content?.[0]?.text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

export function buildProposalUserPrompt(input: GenerateProposalInput): string {
  return `# Project: ${input.projectName}
Path: ${input.projectPath}

## Feature to adopt
**Name:** ${input.feature.featureName}
**Category:** ${input.feature.category}
**Description:** ${input.feature.description}
**Integration recipe:**
${input.feature.integrationRecipe}

## Current CLAUDE.md (truncated if large)
\`\`\`
${truncateForPrompt(input.claudeMd, DEFAULT_MAX_BYTES_PER_FILE)}
\`\`\`

## Current .claude/settings.json (truncated if large)
\`\`\`json
${truncateForPrompt(input.settingsJson, DEFAULT_MAX_BYTES_PER_FILE)}
\`\`\`

Produce the proposal per the rules in your system prompt.`;
}

export async function generateProposal(
  input: GenerateProposalInput,
  deps: GenerateProposalDeps = {},
): Promise<string> {
  const callClaude = deps.callClaude ?? defaultCallClaude;
  const userPrompt = buildProposalUserPrompt(input);
  return await callClaude(PROPOSAL_SYSTEM_PROMPT, userPrompt);
}

// ----------------------------------------------------------------------------
// Per-project orchestrator + report renderer
// ----------------------------------------------------------------------------

export interface ProposeProjectResult {
  projectName: string;
  projectPath: string;
  proposals: {
    feature: FeatureGap;
    markdown: string;
    /** Phase 11.3 — DB id of the persisted proposal row.
     * `null` when persistence was disabled or the write failed. */
    proposalId?: number | null;
    error?: string;
  }[];
}

async function readIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function proposeForProject(
  prisma: PrismaClient,
  projectId: number,
  options: {
    deps?: GenerateProposalDeps;
    /** Cap how many proposals we generate per project per call (cost control). */
    maxFeatures?: number;
    /** Phase 11.3 — persist successful proposals as FeatureProposal rows.
     * Default true. Pass false in tests when you don't want to write. */
    persist?: boolean;
  } = {},
): Promise<ProposeProjectResult> {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const gaps = await findGapsForProject(prisma, projectId);
  const cap = options.maxFeatures ?? 5;
  const targets = gaps.slice(0, cap);
  const persist = options.persist !== false;

  // Load project context once.
  const claudeMdPath = path.join(project.path, "CLAUDE.md");
  const claudeMdLowerPath = path.join(project.path, "claude.md");
  const claudeMd =
    (await readIfExists(claudeMdPath)) || (await readIfExists(claudeMdLowerPath));
  const settingsJson = await readIfExists(
    path.join(project.path, ".claude", "settings.json"),
  );

  const proposals: ProposeProjectResult["proposals"] = [];
  for (const gap of targets) {
    try {
      const markdown = await generateProposal(
        {
          feature: gap,
          projectName: project.name,
          projectPath: project.path,
          claudeMd,
          settingsJson,
        },
        options.deps,
      );

      // Persist as a FeatureProposal row (best-effort; a DB write failure
      // doesn't lose the rendered proposal in the chat response).
      // Contract: `proposalId` is omitted when persist is disabled,
      //           set to a number on successful persist,
      //           set to null when persist was attempted but failed.
      const entry: ProposeProjectResult["proposals"][number] = {
        feature: gap,
        markdown,
      };
      if (persist) {
        try {
          const row = await prisma.featureProposal.create({
            data: {
              projectId,
              featureId: gap.featureId,
              diff: markdown,
              status: "proposed",
            },
          });
          entry.proposalId = row.id;
        } catch (persistError) {
          entry.proposalId = null;
          console.warn(
            JSON.stringify({
              event: "proposal_persist_failed",
              projectId,
              featureId: gap.featureId,
              error:
                persistError instanceof Error
                  ? persistError.message
                  : String(persistError),
            }),
          );
        }
      }

      proposals.push(entry);
    } catch (error) {
      proposals.push({
        feature: gap,
        markdown: "",
        proposalId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    projectName: project.name,
    projectPath: project.path,
    proposals,
  };
}

export async function proposeForAll(
  prisma: PrismaClient,
  options: {
    deps?: GenerateProposalDeps;
    maxFeatures?: number;
    /** Optional filter: only audit specific project slugs. */
    projectSlugs?: string[];
  } = {},
): Promise<ProposeProjectResult[]> {
  const where = options.projectSlugs
    ? { slug: { in: options.projectSlugs } }
    : {};
  const projects = await prisma.project.findMany({ where, select: { id: true } });
  const out: ProposeProjectResult[] = [];
  for (const p of projects) {
    try {
      out.push(await proposeForProject(prisma, p.id, options));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "propose_project_failed",
          projectId: p.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Markdown report rendering — for the slash-command response
// ----------------------------------------------------------------------------

export function renderProposalReport(results: ProposeProjectResult[]): string {
  const lines: string[] = [];
  lines.push("# Anthropic Feature Proposals\n");
  if (results.length === 0) {
    lines.push("_No projects to audit._\n");
    return lines.join("\n");
  }

  let totalProposals = 0;
  let projectsWithGaps = 0;

  for (const project of results) {
    if (project.proposals.length === 0) continue;
    projectsWithGaps++;
    lines.push(`## ${project.projectName}\n`);
    lines.push(`Path: \`${project.projectPath}\`\n`);
    for (const p of project.proposals) {
      totalProposals++;
      const idSuffix = typeof p.proposalId === "number" ? ` _(proposal #${p.proposalId})_` : "";
      lines.push(`### Feature: ${p.feature.featureName} _(${p.feature.category})_${idSuffix}\n`);
      if (p.error) {
        lines.push(`> Proposal generation failed: ${p.error}\n`);
        continue;
      }
      lines.push(p.markdown.trim() + "\n");
      if (typeof p.proposalId === "number") {
        lines.push(
          `_Mark this proposal: PATCH /api/feature-proposals/${p.proposalId} { status: "accepted" | "rejected" | "applied" }._\n`,
        );
      }
    }
  }

  // Summary at the top so the user sees scope before scrolling diffs.
  const summary = [
    "## Summary\n",
    `- Projects audited: ${results.length}`,
    `- Projects with gap proposals: ${projectsWithGaps}`,
    `- Total proposals generated: ${totalProposals}\n`,
    "Each proposal below is a draft for your review. Cascade does NOT",
    "auto-apply any of them — copy the diff into the project's Claude",
    "Code session and review before landing.",
    "",
  ].join("\n");
  // Splice summary in after the H1
  return lines[0] + "\n" + summary + lines.slice(1).join("\n");
}

/** Detect whether the latest user message in chat invokes the propose command. */
export function isFeatureProposeCommand(messageText: string): boolean {
  return /^\s*\/anthropic-feature-propose\b/i.test(messageText);
}

/** Parse optional trailing project slug(s) from the command. */
export function parseFeatureProposeArgs(messageText: string): {
  projectSlugs: string[];
} {
  const m = messageText.match(/^\s*\/anthropic-feature-propose\s+(.*)$/i);
  if (!m) return { projectSlugs: [] };
  const tokens = m[1]
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.startsWith("--"));
  return { projectSlugs: tokens };
}
