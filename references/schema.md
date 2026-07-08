# Data Model Reference

## Project
The central entity. Represents a software project being monitored.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| name | String | — | Display name |
| slug | String | — | Unique, URL-safe identifier |
| path | String | — | Absolute filesystem path |
| status | String | "building" | building, complete, deployed, backburner, paused, archived |
| stack | String (JSON) | "{}" | Frontend, backend, db, hosting, language |
| currentPhase | String | "phase-1-foundation" | Current development phase |
| currentRequest | String? | null | Current request number (e.g., "2.3") |
| health | String | "idle" | healthy, warning, blocked, idle |
| healthDetails | String (JSON) | "{}" | Test pass rate, debt count, blockers |
| githubRepo | String? | null | e.g., "username/my-app" |
| autonomyMode | String | "semi" | full, semi, manual |
| agentTeamsEnabled | Boolean | false | — |
| prWorkflowEnabled | Boolean | false | — |
| progressScore | Int | 0 | 0-100 composite progress score |
| progressDetails | String (JSON) | "{}" | Breakdown: phases, tests, readiness scores |
| deploymentInfo | String (JSON) | "{}" | Deployment URL, provider, health endpoint |
| businessStage | String | "building" | building, pre-sale, active-sale, revenue, growth, internal |
| projectContext | String? | null | Persisted context.md content — project story, stakeholders, goals |
| completionCriteria | String? | null | Persisted done.md content — what "done" means for this project |
| badges | String (JSON) | "[]" | Array: deployed, client, testing, awaiting-review, versioned |
| deadline | DateTime? | null | Optional project deadline |
| lastSessionEndedAt | DateTime? | null | When last Claude session ended |
| kickoffTemplateId | Int? | null | FK to KickoffTemplate |
| lastActivityAt | DateTime | now() | — |
| lastScannedAt | DateTime | now() | — |
| createdAt | DateTime | now() | — |
| updatedAt | DateTime | auto | — |

**Relations:** lessons[], auditSnapshots[], activityEvents[], humanTasks[], dispatchOutcomes[], dispatches[], featureUsages[], featureProposals[], kickoffTemplate?
**Indexes:** lastActivityAt, (status, lastActivityAt) — phase 31

## HumanTask
Tasks that require human action — assets, credentials, manual testing, etc.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| title | String | — | Task description |
| category | String | "other" | asset, credential, testing, deploy, review, external, other |
| priority | String | "normal" | high, normal, low |
| status | String | "pending" | pending, done |
| projectId | Int? | null | FK to Project |
| projectSlug | String? | null | Project slug for display |
| createdBy | String | "claude" | claude, user, delamain |
| createdAt | DateTime | now() | — |
| completedAt | DateTime? | null | When marked done |

**Relations:** project?
**Indexes:** (status, priority, createdAt) — phase 31

## KnowledgeLesson
Lessons harvested from project audits and corrections.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| title | String | — | Lesson title |
| content | String | — | Markdown content |
| category | String | — | deployment, auth, database, performance, testing, error-handling, integrations, anti-patterns, architecture, tooling |
| sourceProjectId | Int? | null | FK to Project |
| sourceFile | String? | null | File where lesson was found |
| sourcePhase | String? | null | Phase when discovered |
| tags | String (JSON) | "[]" | Array of tag strings |
| severity | String | "nice-to-know" | critical, important, nice-to-know |
| discoveredAt | DateTime | now() | — |
| verified | Boolean | false | Manually verified |
| timesReferenced | Int | 0 | Incremented on read |

**Relations:** sourceProject?

## KickoffTemplate
Templates used to generate project kickoff prompts.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| name | String | — | Template name |
| description | String | — | Brief description |
| content | String | — | Full markdown template |
| projectType | String | "web-app" | web-app, game, api, mobile, other |
| isDefault | Boolean | false | Default template flag |
| createdAt | DateTime | now() | — |
| updatedAt | DateTime | auto | — |

**Relations:** projects[]

## AuditSnapshot
Point-in-time audit results for a project.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int | — | FK to Project |
| phase | String | — | Phase when captured |
| auditType | String | — | test-audit, bughunt, optimize, drift-audit |
| grade | String? | null | A, B, Critical, etc. |
| findings | String (JSON) | "{}" | Structured results |
| isRead | Boolean | false | Powers unread indicators |
| capturedAt | DateTime | now() | — |

**Relations:** project

## ActivityEvent
Timeline of project events.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int? | null | FK to Project (null for cross-project) |
| eventType | String | — | commit, phase-complete, audit-complete, lesson-harvested, advisory-sent, project-created, blocker-detected, debt-resolved, session-complete |
| summary | String | — | Event description |
| details | String? | null | JSON details |
| createdAt | DateTime | now() | — |

**Relations:** project?
**Indexes:** createdAt, (projectId, createdAt) — phase 31

## DispatchOutcome
Tracks what the Overseer recommended vs what actually happened.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int | — | FK to Project |
| projectSlug | String | — | Project slug |
| mode | String | — | continue, audit, investigate, custom |
| healthAtDispatch | String | — | Project health when dispatched |
| outcome | String | — | success, blocker, attention-needed, test-failure, unknown |
| signals | String (JSON) | "[]" | Escalation signal types detected |
| dispatchedAt | DateTime | — | When dispatch was issued |
| completedAt | DateTime | now() | When session ended |
| dispatchId | String? | null | Phase 23.2 — FK to Dispatch.id (unique). Links outcome to its lifecycle row |
| goalCondition | String? | null | Phase 41.2 — /goal condition composed at dispatch from the request's acceptance criteria (null for ad-hoc dispatches) |
| goalAchieved | Boolean? | null | Phase 41.2 — goal-evaluator verdict parsed from the session log; null = no verdict surfaced |
| goalReason | String? | null | Phase 41.2 — evaluator's stated reason, when the log marker carried one |

**Relations:** project, dispatch?

## Dispatch (phase 23.2)
First-class lifecycle row for a Claude Code dispatch. Written at enqueue, transitioned by the dispatcher (queued → started) and the webhook (started → completed/failed), timed out by the watchdog. `idempotencyKey` is the canonical correlation handle between the dispatcher, the spawned Claude Code session (passed via `CASCADE_DISPATCH_ID` env), and the Stop-hook webhook.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | String | cuid() | Primary key |
| idempotencyKey | String | cuid() | Unique. Threaded into the spawn env as `CASCADE_DISPATCH_ID` |
| projectId | Int | — | FK to Project |
| projectSlug | String | — | Denormalized for fast lookups |
| mode | String | — | continue, audit, investigate, custom |
| customPrompt | String? | null | Set when mode = custom |
| status | String | "queued" | queued, started, completed, failed, timeout |
| prompt | String? | null | Truncated prompt snapshot |
| healthAtDispatch | String? | null | Project health when dispatched |
| expectedBy | DateTime? | null | Watchdog deadline; if exceeded, status flips to timeout |
| enqueuedAt | DateTime | now() | — |
| startedAt | DateTime? | null | Set when the spawn returns |
| completedAt | DateTime? | null | Set by the webhook |
| errorMessage | String? | null | Set on failure or timeout |

**Relations:** project, outcome? (1:1 → DispatchOutcome.dispatchId)
**Indexes:** (projectId, status), expectedBy, status

## ChatSession
Phase 12A.1. First-class container for conversation state. The
`workingMemory` JSON document is the canonical session-scoped store
that the Overseer reads and writes via tools (replaces the prior
"stuff-everything-in-the-system-prompt" pattern).

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | String | cuid() | Primary key |
| startedAt | DateTime | now() | UTC midnight for backfilled rows; real timestamp for newly created rows |
| closedAt | DateTime? | null | Set when the session ends; writes to a closed session throw |
| activeFlow | String? | null | "inventory_walk", "dispatch_planning", "incident_triage", or null |
| workingMemory | String | "{}" | JSON document; deep-merged via `mergeWorkingMemory` |
| compressedHistory | String? | null | Phase 12E — JSON: `{summarizedThroughMessageCount, summary}`. Cached summary of older messages |

**Relations:** messages (1:N → ChatMessage)
**Indexes:** startedAt, closedAt

## ChatMessage
Overseer conversation history, grouped by date and (going forward) by ChatSession.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| role | String | — | user, assistant |
| content | String | — | Message content |
| sessionDate | String | — | YYYY-MM-DD grouping key (legacy, kept for backfill compatibility) |
| sessionId | String? | null | Phase 12A.1 — links to ChatSession; backfill via scripts/backfill-chat-sessions.ts |
| toolCalls | String? | null | Phase 12A.1 — JSON string of structured tool invocations on assistant turns |
| createdAt | DateTime | now() | — |

**Relations:** session (N:1 → ChatSession, optional during transition)
**Indexes:** sessionId, sessionDate, (sessionDate, createdAt) — phase 31

## Reminder
Conditional alerts triggered by project state changes.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| message | String | — | Reminder text |
| conditionType | String | — | project-health, phase-complete, project-deployed, custom |
| conditionValue | String | — | e.g., "project-slug:healthy" |
| projectSlug | String? | null | Related project |
| status | String | "pending" | pending, triggered, dismissed |
| createdBy | String | "overseer" | overseer or user |
| createdAt | DateTime | now() | — |
| triggeredAt | DateTime? | null | — |

## UpstreamFeature (phase 11.1)
Vendor-agnostic catalog of upstream AI capabilities Cascade tracks.
Seeded from `knowledge/anthropic-features.md`; new entries can land via
the harvester (low-confidence) or the slash-command web-fetch path
(after human review).

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| vendor | String | "anthropic" | Defaults to anthropic; future "openai" / etc. |
| name | String | — | Unique per `(vendor, name)` |
| category | String | — | hook \| skill \| slash-command \| mcp-server \| sub-agent \| agent-team \| settings-flag \| sdk-feature \| api-feature \| memory \| other |
| description | String | — | 2-3 sentences |
| integrationRecipe | String | — | Concrete integration steps |
| source | String | "manual" | "manual" \| URL \| "harvester" |
| addedBy | String | "manual" | "manual" \| "harvester" \| "fetch" |
| confidence | Int | 100 | 0-100; harvester defaults low, curated entries 100 |
| detector | String? | null | Function name in `lib/anthropic-feature-detectors.ts` |
| discoveredAt | DateTime | now() | — |
| updatedAt | DateTime | updatedAt | — |

**Relations:** usages[] (1:N → ProjectFeatureUsage), proposals[] (1:N → FeatureProposal)

## ProjectFeatureUsage (phase 11.1)
Per-project ledger: which features are detected as in use. Derived
from the audit pass on every project filesystem; never hand-maintained.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int | — | FK to Project |
| featureId | Int | — | FK to UpstreamFeature |
| signal | String | — | Free-form: where the detector matched |
| detectedAt | DateTime | now() | — |

Unique constraint: `(projectId, featureId)`. Indexed on both FKs.

## FeatureProposal (phase 11.3)
Persistence for feature proposals generated by the Anthropic Feature Proposer. Each row is a Claude-drafted diff for one `(project, missing-feature)` pair. Status flows `proposed → accepted | rejected | applied` via `PATCH /api/feature-proposals/[id]`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| projectId | Int | — | FK to Project |
| featureId | Int | — | FK to UpstreamFeature |
| diff | String | — | Claude-generated Markdown diff |
| status | String | "proposed" | proposed, accepted, rejected, applied |
| generatedAt | DateTime | now() | — |
| resolvedAt | DateTime? | null | Set when status leaves "proposed" |
| resolvedBy | String? | null | "user", "claude", or "system" |
| notes | String? | null | Free-form context |

**Relations:** project, feature
**Indexes:** projectId, featureId, status, generatedAt

## ToolCallEvent (phase 24.2)
Tool-call observability. One row per `registry.execute(...)` invocation in `runToolUseLoop`. Drives `/observability/tools` and the `get_tool_call_stats` overseer tool. The `resultUsed` column is reserved for a follow-up heuristic; defaults to true so absence-of-data doesn't penalize tools.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| sessionId | String | — | The Anthropic session id (not Cascade's ChatSession.id) |
| iteration | Int | — | Loop iteration index |
| toolName | String | — | Tool name from the registry |
| input | String | — | JSON, truncated to 4 KB |
| outputSize | Int | — | Output payload size in bytes |
| success | Boolean | — | — |
| errorMessage | String? | null | Set on failure |
| durationMs | Int | — | Wall-clock duration |
| resultUsed | Boolean? | true | Reserved; future heuristic |
| createdAt | DateTime | now() | — |

**Indexes:** (sessionId, createdAt), toolName, createdAt

## AnthropicUsageEvent (phase 23.3)
Fire-and-forget telemetry for every Anthropic API call site. Drives `/observability/cache` hit-rate visibility and guards the Phase 23.4 prompt-caching rollout against silent regressions.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | autoincrement | Primary key |
| callSite | String | — | "overseer.chat", "summarizer", "feature-proposer", "wizard", "project.chat", "briefing" |
| model | String | — | Model id used for the call |
| inputTokens | Int | — | — |
| cacheReadInputTokens | Int | 0 | — |
| cacheCreationInputTokens | Int | 0 | — |
| cacheCreation5mTokens | Int | 0 | — |
| cacheCreation1hTokens | Int | 0 | — |
| outputTokens | Int | — | — |
| durationMs | Int | — | Wall-clock duration |
| createdAt | DateTime | now() | — |

**Indexes:** (callSite, createdAt), createdAt, model

## CascadeConfig (phase 11.1)
Single-row configuration table for Cascade-wide state. Always upserted
on `id = 1`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | Int | 1 | Single-row enforced |
| lastSeenClaudeCodeVersion | String? | null | Tracked by `lib/version-watcher.ts` |
| updatedAt | DateTime | updatedAt | — |
