# Session Handoff — Kilroy
Date: 2026-04-12

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Named by Justin. Other project Claude instances are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's overseer chat.

## Current State
All original phases (1-6) complete. Massive autonomy upgrade built across multiple sessions. 330+ tests, validate.sh passes, 17 active projects in fleet.

## What Was Built (Autonomy Upgrade)

### Progress Scoring
- 0-100 composite score: phase completion (50), test health (25), build readiness (25)
- Real progress bars on roadmap and project tiles

### Phase 1 — Feedback Loop (COMPLETE)
- Stop hooks installed on all 17 projects via scripts/install-hooks.ts
- POST /api/webhook/session-complete — targeted single-project scan on session end
- [NEEDS ATTENTION] detection in handoff.md → auto-blocks project
- Dashboard auto-refreshes on window focus (visibilitychange)
- Schema: complete status, deploymentInfo, lastSessionEndedAt

### Phase 2 — Session Intelligence (COMPLETE)
- lib/session-reader.ts — reads .claude/sessions/*.md
- GET /api/projects/[slug]/sessions — session history endpoint
- Delamain's overseer prompt includes per-project session summaries
- Session history panel on project detail page

### Phase 3 — Delamain Gets Smarter (COMPLETE)
- lib/escalation-detector.ts — detects [NEEDS ATTENTION], [LESSON], [HUMAN TODO], test failures, phase completion
- lib/playbook-learner.ts — clusters recurring patterns across projects
- GET /api/playbook/suggestions — pattern analysis endpoint
- Smart dispatch logic in overseer prompt (blocked > warning > healthy)

### Additional Features Built
- **Desktop notifications** — browser Notification API for escalation events
- **Morning briefing** — auto-generated on first visit of day via Claude Sonnet
- **Conversation memory** — ChatMessage model, persists overseer chat, yesterday's context in prompt
- **Semi-auto dispatch** — auto-executes continue-only dispatches when enabled
- **Voice input** — SpeechRecognition API toggle on overseer chat
- **CLI auth status** — Settings page shows Vercel/GitHub/Railway/1Password auth with Login buttons
- **Remaining work panel** — project detail page shows phase-by-phase request completion
- **Human tasks** — /tasks page, [HUMAN TODO] auto-detection, CRUD API
- **Retroactive harvest** — 143 lessons extracted from git history across all projects
- **Dispatch outcome tracking** — links dispatches to session results, feeds stats into Delamain
- **Backburner status** — parked projects suppressed from sprint planning
- **Business stage** — per-project commercial status field
- **Project context & completion criteria** — .claude/context.md and .claude/done.md
- **Delamain portrait** — sidebar, overseer chat, briefing, favicon

## Database
- SQLite at ./dev.db (project root, NOT prisma/)
- 17 projects, 143+ knowledge lessons

## Fleet Status
- PyrrhicVictory: backburner
- agentify: deleted
- romereno: phase-8-scale, 87% progress, 551 tests

## Delamain's Pending Requests
- Inter-project dependency mapping — NOT YET
- Direct terminal visibility — DEFERRED (session logs suffice)

## What's Next
- Write context.md and done.md for each project
- Let sessions accumulate for Delamain's learning
- Run the fleet through dispatch → session → feedback loop

[LESSON] dev.db lives at project root, not prisma/. DATABASE_URL relative path resolves from project root.
[LESSON] Delamain's most valuable upgrade was closing the feedback loop on its own recommendations.
