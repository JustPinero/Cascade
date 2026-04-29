/**
 * Phase 19.1 — derive a status-aware display contract for the
 * project tile / roadmap progress surface.
 *
 * Rationale: the dashboard previously showed the raw `progressScore`
 * (phase-completion math) prominently for every project. For
 * projects in `complete` or `deployed` status, that score is
 * misleading — these projects shipped before all tracked phases
 * formally closed, so the score never hit 100%. A shipped product
 * displaying "14%" reads as broken.
 *
 * Consumers branch on `kind`: render a "Deployed" / "Complete"
 * badge for `shipped`, or the existing progress bar for
 * `in-progress`. The raw score is still returned in both shapes
 * so a tooltip can surface it on hover.
 */

export interface CompletionDisplayInput {
  status: string;
  progressScore?: number;
}

export type CompletionDisplay =
  | { kind: "shipped"; label: "Deployed" | "Complete"; score: number }
  | { kind: "in-progress"; score: number };

function clampScore(score: number | undefined): number {
  const raw = score ?? 0;
  return Math.max(0, Math.min(raw, 100));
}

export function getCompletionDisplay(
  project: CompletionDisplayInput
): CompletionDisplay {
  const score = clampScore(project.progressScore);
  if (project.status === "deployed") {
    return { kind: "shipped", label: "Deployed", score };
  }
  if (project.status === "complete") {
    return { kind: "shipped", label: "Complete", score };
  }
  return { kind: "in-progress", score };
}
