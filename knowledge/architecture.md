# Architecture Lessons

Category: architecture
Last harvested: —

## Lessons

_No lessons harvested yet. The knowledge harvester will populate this file automatically._

<!-- Harvester instructions:
- Look for [LESSON] tags in audits/ and .claude/handoff.md files
- Look for architecture-related findings in bughunt and optimize audits
- Keywords: architecture, structure, pattern, design, component, module, boundary, separation
-->

## From phases 11.1–11.3 (Anthropic feature awareness)

### Slash-command interception
- [LESSON] Intercept slash commands BEFORE the Claude API call in chat routes — keeps the existing chat path completely unchanged when no slash matches. Order: check → propose → fall through. Strict word-boundary regex on each matcher prevents overlap.
- [LESSON] Synthesize the SSE envelope (`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_stop`) when emitting a static Markdown payload so the existing client renders it without any client-side changes.

### Vendor-agnostic schema design
- [LESSON] When a feature might extend across vendors later (Anthropic now, OpenAI/etc. eventually), add a `vendor String @default("anthropic")` field on day one. Cheap up-front, expensive refactor when skipped.
- [LESSON] Promotion path: a prompt or pattern that proves itself across multiple projects can graduate into a baked-in flavored variant. Keep proven and experimental separate while iterating; merge when stable. (See KickoffPlaybook universal/ vs Cascade templates/ relationship.)

### Catalog + ledger + proposer triad
- [LESSON] Three-layer pattern for "what features exist / who uses what / how do we adopt": (1) catalog (`UpstreamFeature` rows), (2) ledger (`ProjectFeatureUsage` derived from filesystem audit, never hand-maintained), (3) proposer (Claude-drafted per-project diffs against the gap). Each layer has one job and tests independently.
- [LESSON] "Skip / need clarification" branches in Claude system prompts beat fabrication. Constrain output: "if the recipe doesn't fit, say `### Recommendation: skip` with one line; if you need info you weren't shown, ask one short question under `### Need clarification` and stop." Smoke-tested against Sonnet — it correctly bails on empty CLAUDE.md instead of inventing.

### Disclaimer-at-top is load-bearing copy
- [LESSON] When the body of a generated response is action-shaped (diffs, instructions, proposed changes), put any "do not auto-apply / human review required" disclaimer in the SUMMARY at the top, not the footer. The moment a user scrolls to the diff, they're in copy-paste mode. The reminder has to land before they get there.
