# Session Handoff — Kilroy
Date: 2026-04-29 — Phase 12 complete (12A through 12F merged to main)

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Other Claude instances dispatched into managed projects are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's Overseer chat.

## Current State

The full Overseer tool-use migration shipped end-to-end. The bug
Justin reported via Delamain's [ENGINEER] message — *"losing
conversational context mid-session during sprint/inventory flows…
repeating questions and losing track of answers already given"* —
is fixed at the architecture level and guarded by a regression test.

- **673 tests passing** (was 548 at the start of Phase 12; +125 added).
- `scripts/validate.sh` green: env + lint + tsc + prisma generate + tests + build.
- `app/api/overseer/chat/route.ts` shrunk from 615 → 278 lines.
- All Overseer chat now flows through `runToolUseLoop` with
  structured tool access. The legacy SP-injection streaming branch
  is gone.

## What landed (chronological)

### Phase 12A — Foundation
- **12A.1** ChatSession schema + working-memory helpers + idempotent backfill script
- **12A.2** ToolRegistry + runToolUseLoop + injectable AnthropicCaller
- **12A.3** query_project tool + opt-in route branch

### Phase 12B — Read-tool migration
- **12B.1** query_projects, get_recent_activity, get_session_logs, get_dispatch_outcomes
- **12B.2** get_yesterday_summary, get_engineer_messages, get_playbook
- **12B.3** SP slim + `useTools` default flipped to true + slash-command precedence

### Phase 12C — Write-tool migration
- **12C.1** update_session_memory + set_active_flow + get_session_state + route session binding
- **12C.2** propose_dispatch + create_reminder + create_human_todo
- **12C.3** SP guidance for the new write tools + the inventory-walk pattern

### Phase 12D — Flow tracking + bug-fix proof
- **12D.1** End-to-end regression test: 5-project inventory walk with workingMemory accumulation, follow-up update preserves state, activeFlow advances through documented sequence

### Phase 12E — History compression safety net
- **12E.1** ChatSession.compressedHistory column, lib/chat-history-compressor.ts with cached summary, Haiku-backed default summarizer, route integration (threshold 25, keepRecent 10)

### Phase 12F — Decommission
- **12F.1** Removed buildOverseerSystemPrompt (280 lines), the legacy fetch fallback branch, formatTimeAgo, the [REMINDER]/[HUMAN TODO]/[PLAYBOOK]/[ENGINEER] tag formats from the SP, and unused imports (fs, path, getSessionLogs). Kept the [DISPATCH] tag format because the dashboard parses it.

## Architecture summary (post-Phase-12)

**Tool registry.** `lib/overseer-tools-registry-default.ts` registers
14 tools across read (8), session-memory (3), and structured-output
(3) categories. Every dispatched chat request gets a fresh registry
(no shared mutable state). See `references/api-contracts.md` for the
full tool surface.

**Session binding.** Every request resolves today's `ChatSession`
via `getOrCreateSession` and attaches `sessionId` to `ToolContext`.
That makes `update_session_memory`, `set_active_flow`,
`get_session_state`, and `propose_dispatch` work without further
plumbing.

**History compression.** Conversations > 25 messages get the older
portion replaced with a cached Haiku summary, keeping the most
recent 10 verbatim. workingMemory remains the canonical store for
confirmed facts; this just keeps the raw message log under control.

**System prompt.** Stable, ~3K characters, advertises the full tool
surface + the inventory-walk pattern + style notes. No per-turn
data is baked in — caches cleanly across turns.

**Dashboard bridge.** The model still emits `[DISPATCH]` text tags
because the dashboard parses them. The structured `propose_dispatch`
tool is the canonical record. When the dashboard migrates to read
`workingMemory.proposedDispatches`, the tag emission can go too.

## How to run / verify

- Start dev: `pnpm dev`
- Unit + integration: `pnpm test` (673 tests)
- Full validation: `bash scripts/validate.sh`
- Manual smoke: open the dashboard, ask Delamain about a project. Behind the scenes the tool path now runs, calls `query_project`, returns a fresh answer.

## Things deferred (not blocking the bug fix)

- Streaming token-by-token in the tool path's terminal text turn (currently one SSE chunk on the way out)
- Dashboard read of `workingMemory.proposedDispatches` (today the dashboard still reads `[DISPATCH]` tags from chat text)
- `dispatch_project` / `commit_dispatches` / `update_project` effect tools (model can already propose; user reviews and clicks Execute Sprint via existing UI)
- Token-aware compression (today: count-based at threshold 25 / keepRecent 10)

These can come later as small follow-ups. None of them affect the bug fix.
