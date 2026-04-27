# Session Handoff — Kilroy
Date: 2026-04-27 (afternoon — phase 11.1 done, awaiting your review)

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Other Claude instances dispatched into managed projects are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's Overseer chat.

## Current State
Phase 11.1 implementation is done locally. **Justin asked to review before push** — nothing has been committed or pushed yet.

- `validate.sh` passes end-to-end: env, lint, typecheck, **511/511 tests** (was 428 — added 83), build.
- Working tree is dirty with the phase 11.1 changes; ready for review.
- The Cascade dev server still running on PID 13187 was started before the schema change. After review, the user will likely want to restart so the new Prisma client and slash command load.

## What Was Built — Phase 11.1: Anthropic Feature Update Check (catalog + ledger + slash command)

### Headline summary
Cascade can now answer two questions on demand: (1) **what Claude / Claude Code features have shipped that aren't yet in our catalog?**, and (2) **which projects are using which features?** Triggered by `/anthropic-feature-update-check` in the Overseer chat, or fired implicitly via the Stop-hook webhook (per-project audit). Discovery is human-gated: NEVER auto-applies any change to a project.

### Vendor-agnostic by design
Every new model has a `vendor` field defaulting to `"anthropic"`. A future `11.x-openai-feature-update-check` reuses the schema by switching vendor and pointing at different sources. The slash command name + the `[ANTHROPIC]` tag are vendor-specific per Justin's call.

### Files added (new)
- `prisma/schema.prisma` — 3 new models: `UpstreamFeature`, `ProjectFeatureUsage`, `CascadeConfig`
- `knowledge/anthropic-features.md` — seed catalog with **21 features** (5 hooks, 4 Claude Code primitives, 7 settings/integrations, 5 API features). Six-field schema per entry.
- `lib/anthropic-features-md.ts` — parser + DB sync for the seed file
- `lib/anthropic-features-md.test.ts` — 13 tests
- `lib/anthropic-feature-detectors.ts` — 21 detector functions + `loadDetectorInput()` (single-pass project filesystem scan)
- `lib/anthropic-feature-detectors.test.ts` — 27 tests
- `lib/anthropic-feature-check.ts` — `auditProjectFeatureUsage`, `auditAllProjects`, `runFeatureCheck`, `renderFeatureCheckReport`, `isFeatureCheckCommand`, `parseCandidatesJson`, `isDuplicateName`, `syncSeedCatalog`
- `lib/anthropic-feature-check.test.ts` — 13 tests (parser + dedup + run + filtering + dedup-against-catalog)
- `lib/anthropic-feature-check.audit.test.ts` — 6 tests (real-fs project audit + idempotency + stale-row pruning + best-effort batch)
- `lib/anthropic-feature-check.harvest.test.ts` — 5 tests (`[ANTHROPIC]` tag extraction)
- `lib/version-watcher.ts` — `checkClaudeCodeVersion()` with first-record / unchanged / changed branches; emits `feature-check-needed` ActivityEvent on change
- `lib/version-watcher.test.ts` — 5 tests
- `scripts/run-version-watcher.ts` — invoked from `start.sh` after `prisma db push`, never blocks startup
- `app/api/overseer/chat/route.feature-check.test.ts` — 4 tests (slash command interception, SSE rendering, fall-through to existing chat preserved)
- `app/api/webhook/session-complete/route.feature-audit.test.ts` — 3 tests (best-effort audit hook, 200 even on audit failure, no-op when project not found)
- `requests/phase-11-upstream-feature-awareness/11.1-anthropic-feature-update-check.md` — the request file (TDD format)

### Files modified (extensions, surgically scoped)
- `prisma/schema.prisma` — added back-relation `featureUsages ProjectFeatureUsage[]` on `Project`; otherwise untouched
- `lib/db.test.ts` — appended 7 tests covering UpstreamFeature / ProjectFeatureUsage / CascadeConfig (existing 10 tests untouched)
- `lib/knowledge-harvester.ts` — added `extractAnthropicTags()` next to `extractTaggedLessons()`. **Existing `[LESSON]` extraction unchanged.**
- `app/api/overseer/chat/route.ts` — slash-command interception added BEFORE the Claude API call. **Existing chat path unchanged when message isn't a slash command.** Verified by the route.feature-check.test.ts test "does NOT trigger feature-check on a normal message".
- `app/api/webhook/session-complete/route.ts` — added best-effort `auditProjectFeatureUsage` call after the existing escalation work. **Wrapped in try/catch — webhook returns 200 even if the audit throws.**
- `scripts/start.sh` — appended a single `tsx scripts/run-version-watcher.ts` call after `prisma db push`. **Never blocks startup (`|| true`).**
- `references/schema.md` — documented the 3 new models
- `references/architecture.md` — added Key Architectural Decision #10

### Templates / managed projects — verified untouched
Per Justin's main guideline: "don't break any of the existing templates or claude configurations in our projects."
- `templates/` directory: not modified.
- Managed-project `.claude/` configs: not modified by anything in this phase. The audit reads project filesystems but never writes to them. The advisory engine (the only path that writes into project trees) was not touched.
- `references/cascade-kickoff.md`: not modified.
- The kickoff template's behavior is unchanged.

### Test count
- Before phase 11.1: 428 tests / 69 files
- After phase 11.1: **511 tests / 77 files** (+83 tests, +8 new test files)
- All passing. `validate.sh` end-to-end green.

### Known follow-ups (intentionally deferred to phase 11.2)
- **Proposer.** Generates per-project diffs that adopt a feature; this phase only catalogs and ledgers.
- **Template propagation.** Bumping the kickoff template version when a feature reaches adoption threshold.
- **Auto-apply path.** Out of scope by design — every adoption stays human-gated.
- **Default `ANTHROPIC_FEATURE_SOURCES` URL list.** Currently empty in `.env.example` — set the env var to enable the discover step. Without it, the slash command still runs (catalog sync + audit) but emits no new candidates from web sources.
- **`extractAnthropicTags` integration into the runFeatureCheck flow.** The function exists and is tested; wiring it into the runFeatureCheck candidate stream (low-confidence, addedBy="harvester") is a small follow-up.

## Review Path — Suggested

1. Open `requests/phase-11-upstream-feature-awareness/11.1-anthropic-feature-update-check.md` and confirm acceptance criteria match what shipped. (Most do; flag anything you want trimmed or added before commit.)
2. Open `knowledge/anthropic-features.md` and edit / annotate any feature you want renamed, recategorized, or rewritten. The catalog is the ground truth for everything else, so edits here propagate.
3. Skim `lib/anthropic-feature-detectors.ts` — 21 detectors. Heuristic-heavy (CLAUDE.md keyword matches and code-grep markers). Comfortable with the heuristics?
4. Open `app/api/overseer/chat/route.ts` and confirm the slash-command branch reads cleanly and the existing chat path is unchanged below it.
5. Open `app/api/webhook/session-complete/route.ts` and confirm the audit hook is wrapped in try/catch and webhook still returns 200 on audit failure.
6. Run `bash scripts/validate.sh` yourself to confirm 511/511 + build pass on your end.
7. After review: commit + push when ready. Suggested message:
   ```
   feat(phase-11.1): anthropic feature update check — catalog + ledger + slash command
   ```

## Restart Caveat
After review:

```bash
bash scripts/restart.sh
```

That picks up the new schema + the new slash command + the version-watcher hook.

## Open Items (non-blocking)
- API key rotation: still pending. The Anthropic key was exposed earlier in the session and the 1Password Cascade Runtime item still holds the leaked value. Not a phase-11.1 issue but worth doing soon.
- `~/package-lock.json` cruft (Turbopack workspace-root warning) — Justin chose to defer.
- `.claude/settings.local.json` was trimmed (stale populate-vault.sh permissions removed) — gitignored, so doesn't appear in any commit.

— Kilroy
