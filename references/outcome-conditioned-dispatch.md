# Outcome-Conditioned Dispatch — proposals informed by what worked

Today, `propose_dispatch` returns a mode based on rules. The Overseer doesn't read the dispatch outcome history, so it cannot say *"I'd recommend continue instead of audit because the last 3 audits on medipal produced no actionable signals."* Closing that loop is what makes Cascade graduate from "dashboard with AI chat" to "system that learns to manage your fleet."

This phase ships the **propose-only** version. The Overseer surfaces an outcome-conditioned recommendation; the developer still triggers. Auto-apply is a future opt-in.

## What "outcome-conditioned" means concretely

When the model is about to call `propose_dispatch({ slug, mode, instructions })`, it should first call a new tool `query_outcome_history({ slug, windowDays })` and consider the returned summary in its proposal. The system prompt is updated to encode this expectation explicitly.

## The new tool

```ts
{
  name: "query_outcome_history",
  description:
    "Read recent dispatch outcomes for a project. Use this BEFORE proposing a dispatch — your recommendation should reflect what has worked recently. Returns per-mode counts, success rate, recurring signals, and a one-line summary.",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string" },
      windowDays: { type: "integer", description: "default: 14" }
    },
    required: ["slug"]
  }
}
```

Output shape:

```jsonc
{
  "slug": "medipal",
  "windowDays": 14,
  "totalDispatches": 8,
  "byMode": {
    "continue": { "count": 5, "successRate": 0.8, "recurringSignals": [] },
    "audit":    { "count": 3, "successRate": 0.0, "recurringSignals": [] }
  },
  "recentTimeline": [
    { "date": "2026-04-29", "mode": "audit", "outcome": "success", "signals": [] },
    { "date": "2026-04-28", "mode": "audit", "outcome": "success", "signals": [] },
    { "date": "2026-04-27", "mode": "audit", "outcome": "success", "signals": [] }
  ],
  "summary":
    "3 of last 3 audits returned no actionable signals; 5 of last 5 continues succeeded. Auditing again is unlikely to surface new issues."
}
```

The `summary` is generated server-side via a heuristic, not via a model call — keeps the tool fast and deterministic. The heuristic logic:

```
let summary = ""
const recentAudits = byMode.audit.recurringSignals
if (byMode.audit.count >= 2 && recentAudits.length === 0) {
  summary += `${byMode.audit.count} of last ${byMode.audit.count} audits returned no actionable signals; `
}
if (byMode.continue.successRate >= 0.7 && byMode.continue.count >= 3) {
  summary += `${Math.round(byMode.continue.successRate*100)}% of recent continues succeeded. `
}
// add stalled-audit heuristic, blocker-recurring heuristic, etc.
```

## System prompt addition

A short section added to `TOOL_PATH_SYSTEM_PROMPT`:

```
# Outcome-conditioned proposals
Before calling propose_dispatch, ALWAYS call query_outcome_history({ slug }) for the
project you're about to dispatch. If the history suggests the developer's preferred mode
isn't producing useful signals (e.g. 3 consecutive audits with no findings), surface that
and propose the alternative mode in your text. The developer still triggers; you advise.
```

About 40 tokens. Inside the cached system prefix.

## Data source

The new `Dispatch` table from Phase 23 is the canonical source. Reading from `DispatchOutcome` joined via `dispatchId` gives the historic record. For projects with pre-`Dispatch` outcomes (rows with null `dispatchId`), fall back to the legacy lookup keyed by `projectSlug`.

## Eval scenarios

To prevent regression on the new behavior, ship at least three eval fixtures (see `references/eval-runner.md`):

1. **Repeated-audit-no-signals**: 5 prior audit outcomes, all `success` with empty `signals`. Expected: model calls `query_outcome_history`, then proposes `continue`, and the final text mentions the audit history.
2. **Continue-keeps-failing**: 3 prior `continue` outcomes with `outcome: blocker`. Expected: model proposes `investigate` and references the blocker pattern.
3. **First-dispatch**: no prior outcomes. Expected: model calls `query_outcome_history` (returns empty), proceeds with whatever mode the rules suggest, and does NOT bring up history in the response.

## What this is NOT

- It's not auto-apply. The Overseer never bypasses the developer.
- It's not a model-driven recommendation engine. The summary is a heuristic in TypeScript. The model uses the summary as an input; it does not invent the summary.
- It's not RL or fine-tuning. We're not adjusting the model based on outcomes — we're adjusting the **prompt context** based on outcomes. Different lever.

## Future opt-in: auto-apply

Once the propose-only path is real and the eval suite has caught a few regressions, auto-apply becomes a playbook flag (`outcomeConditionedAutoApply: true`) that lets routine `continue` dispatches proceed without confirmation when `query_outcome_history` shows the same mode succeeding repeatedly. That's a separate, opt-in slice — not Phase 24's scope.
