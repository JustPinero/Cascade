# Eval Runner — behavioral regression for the AI parts

Unit tests verify wiring. They do not verify that the Overseer picks the right tool, retrieves the right knowledge entry, or escalates the right session. When you swap models, rewrite a system prompt, add a tool, or change tool descriptions, **nothing currently tells you that behavior regressed**. The eval runner closes that gap.

## Hybrid recording (the chosen approach)

- **CI runs against recorded responses.** Deterministic, fast, free, no API key required for PRs from the cookbook.
- **`pnpm eval:refresh` re-records against the live API on demand.** Run before model upgrades, when you suspect drift, or quarterly as hygiene.
- Recorded responses are committed to the repo. Drift between recorded and live behavior is then visible as a diff.

This is the same pattern Anthropic uses internally and the same shape the wider community calls VCR-style replay.

## Layout

```
evals/
  run.ts                          # entry point — `pnpm eval` and `pnpm eval:refresh`
  recorder.ts                     # fetch interceptor: replay or record
  asserters.ts                    # tool-call sequence matchers, top-N matchers
  recordings/
    overseer/
      inventory-walk-medipal.json     # recorded API responses keyed by request hash
      ...
  scenarios/
    overseer/
      inventory-walk-medipal.json     # the actual eval fixture
    knowledge-matcher/
      sqlite-concurrency.json
    escalation-detector/
      ...
```

## Fixture shape

Each scenario is a self-contained JSON file:

```jsonc
{
  "name": "inventory-walk-medipal",
  "kind": "overseer-tool-sequence",
  "input": {
    "messages": [
      { "role": "user", "content": "let's do a fleet inventory walk, start with medipal" }
    ],
    "preconditions": {
      // optional DB state to seed before the run
      "projects": [{ "slug": "medipal", "phase": "phase-5", "health": "healthy" }],
      "dispatchOutcomes": []
    }
  },
  "assert": {
    "toolSequence": [
      { "name": "set_active_flow", "inputContains": { "flow": "inventory_walk" } },
      { "name": "query_project", "inputContains": { "slug": "medipal" } }
    ],
    "finalTextMatches": "/medipal/i",
    "minToolCalls": 2,
    "maxToolCalls": 6
  }
}
```

The `kind` field selects the asserter. Three to start:

- `overseer-tool-sequence` — assert ordered tool calls in a chat completion
- `knowledge-match-top-n` — assert top-N lesson IDs returned for an issue
- `escalation-signals` — assert which signal types `detectEscalations` extracts from a session log

Adding a new asserter is a function in `evals/asserters.ts`, not a new framework.

## Recording mechanics

The recorder swaps `lib/overseer-tools.ts:defaultAnthropicCaller` (and the equivalent fetch in `lib/chat-history-compressor.ts:defaultSummarizer`) with one that:

1. Hashes the request body deterministically (sort keys, exclude `cache_control` since it doesn't affect output, exclude any per-request randomness).
2. **Replay mode (default):** look up `recordings/<scenario>/<hash>.json`. If missing, fail the test loudly.
3. **Record mode (`pnpm eval:refresh`):** call the live API with the real key, write the response to `recordings/<scenario>/<hash>.json`, return it.

Hashes get committed alongside the recordings so the diff shows exactly which prompts changed. A scenario with `cache_control` markers and a scenario without should hash identically — caching is a transport concern, not a behavior change.

## Commands

```jsonc
// package.json
{
  "scripts": {
    "eval": "tsx evals/run.ts",                          // replay-only, no API key
    "eval:refresh": "tsx evals/run.ts --record",         // requires ANTHROPIC_API_KEY
    "eval:refresh:scenario": "tsx evals/run.ts --record --scenario=" // refresh one scenario
  }
}
```

## CI integration

Separate workflow file `.github/workflows/evals.yml`:

- Runs on pull requests **and** nightly
- Replay-only — no API key in PR-triggered jobs
- Allowed to be slower than unit CI (target under 2 min)
- Failures block merge

## When to refresh recordings

- **Always:** before changing the system prompt or tool descriptions in the Overseer
- **Always:** before changing the model ID
- **Always:** when an asserter starts failing in a way that looks like the model is right and the recording is stale (rare; usually it's the prompt that drifted)
- **Quarterly:** as drift hygiene

A refresh that produces a non-trivial recording diff is a **review event** — the diff goes through PR review like any other code change. The eval doesn't blindly accept new behavior just because it ran fresh; you decide whether the new behavior is correct, and if so, the new recording is the new truth.

## What the eval runner does NOT do

- It does not fine-tune. It does not measure model quality across versions for benchmarking. It is a **regression suite**, not a leaderboard.
- It does not stub working memory or session state — those persist via real Prisma calls during the eval (against a scratch SQLite). The model sees a real `get_session_state` response, not a faked one.
- It does not retry failed cases. Flaky behavior in the model is itself a signal worth noticing.

## Initial scenario set

To bootstrap, write at least:

- 5 Overseer scenarios (inventory walk, dispatch after stall, blocker triage, knowledge query, fleet status)
- 3 knowledge-matcher scenarios (one per critical lesson category)
- A 30-log escalation-detector corpus (real logs from past sessions, hand-labeled with expected signal types)

Anything beyond that earns its keep through real regressions caught.
