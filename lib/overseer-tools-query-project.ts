import type { Tool } from "@/lib/overseer-tools";

/**
 * Phase 12A.3 — query_project tool.
 *
 * Returns the current state for one project by slug. Source of truth
 * for project info during a tool-using Overseer conversation; replaces
 * the prior "embed every project's state in the system prompt" pattern.
 */

interface QueryProjectInput {
  slug: string;
}

interface ProgressBreakdown {
  phasesCompleted?: number;
  phasesTotal?: number;
  testFiles?: number;
  hasTypeCheck?: boolean;
  hasLint?: boolean;
  hasBuild?: boolean;
}

export interface QueryProjectOutput {
  found: boolean;
  slug: string;
  name?: string;
  status?: string;
  health?: string;
  phase?: string;
  progressScore?: number;
  businessStage?: string;
  context?: string;
  completionCriteria?: string;
  currentRequest?: string;
  needsAttention?: string;
  lastSessionEndedAt?: string;
  progressBreakdown?: ProgressBreakdown;
}

function safeParseJson(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractProgressBreakdown(json: string): ProgressBreakdown | undefined {
  const parsed = safeParseJson(json);
  if (!parsed) return undefined;
  const out: ProgressBreakdown = {};
  const phases = parsed.phases as { completed?: number; total?: number } | undefined;
  if (phases && typeof phases === "object") {
    if (typeof phases.completed === "number") out.phasesCompleted = phases.completed;
    if (typeof phases.total === "number") out.phasesTotal = phases.total;
  }
  const tests = parsed.tests as { fileCount?: number } | undefined;
  if (tests && typeof tests === "object" && typeof tests.fileCount === "number") {
    out.testFiles = tests.fileCount;
  }
  const readiness = parsed.readiness as
    | { hasTypeCheck?: boolean; hasLint?: boolean; hasBuild?: boolean }
    | undefined;
  if (readiness && typeof readiness === "object") {
    if (typeof readiness.hasTypeCheck === "boolean")
      out.hasTypeCheck = readiness.hasTypeCheck;
    if (typeof readiness.hasLint === "boolean") out.hasLint = readiness.hasLint;
    if (typeof readiness.hasBuild === "boolean") out.hasBuild = readiness.hasBuild;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function extractNeedsAttention(json: string): string | undefined {
  const parsed = safeParseJson(json);
  if (!parsed) return undefined;
  const value = parsed.needsAttention;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export const queryProjectTool: Tool<QueryProjectInput, QueryProjectOutput> = {
  name: "query_project",
  description:
    "Returns the current state for a project by slug — name, status, health, phase, progress, and contextual fields. Use this whenever the developer asks about a specific project; do not invent project information from memory.",
  inputSchema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "The project's lowercase, hyphenated slug (e.g. 'medipal').",
      },
    },
    required: ["slug"],
  },
  handler: async (input, ctx) => {
    const { slug } = input;
    const project = await ctx.prisma.project.findUnique({ where: { slug } });
    if (!project) return { found: false, slug };

    const output: QueryProjectOutput = {
      found: true,
      slug: project.slug,
      name: project.name,
      status: project.status,
      health: project.health,
      phase: project.currentPhase,
      progressScore: project.progressScore,
      businessStage: project.businessStage,
    };

    if (project.projectContext) {
      output.context = project.projectContext.slice(0, 200);
    }
    if (project.completionCriteria) {
      output.completionCriteria = project.completionCriteria.slice(0, 150);
    }
    if (project.currentRequest) {
      output.currentRequest = project.currentRequest;
    }

    const needsAttention = extractNeedsAttention(project.healthDetails);
    if (needsAttention) output.needsAttention = needsAttention;

    if (project.lastSessionEndedAt) {
      output.lastSessionEndedAt = project.lastSessionEndedAt.toISOString();
    }

    const breakdown = extractProgressBreakdown(project.progressDetails);
    if (breakdown) output.progressBreakdown = breakdown;

    return output;
  },
};
