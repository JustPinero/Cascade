# API Contracts

Every route under `app/api/**/route.ts`. Shapes show the fields the handler reads or returns — error responses are always `{ error: string }` with an appropriate status.

Rate limits are token-bucket per IP, scoped by a route key. Format: `N/Mmin` means N requests per M minutes (M is always 60_000 ms = 1 min in source).

---

## Projects

### `GET /api/projects`
Fleet list with health/unread/advisory/task overlays.
- **Request:** none
- **Response:** `Project[]` ordered by `lastActivityAt desc`, each augmented with `unreadAuditCount`, `hasAdvisory`, `advisoryRead`, `pendingHumanTasks`.

### `POST /api/projects/scan`
Full filesystem scan: import + harvest + advisories + reminders.
- **Request:** none
- **Response:** `{ scan, harvest, advisories }` (reminder result is logged but not returned).
- **Notes:** rate-limited 5/min. Writes a `scan-complete` activity event.

### `POST /api/projects/launch`
Create a new project on disk + in DB via the wizard.
- **Request:** `{ name, slug, projectType?, kickoffContent, createGithubRepo?, isPrivate?, autonomyMode?, agentTeamsEnabled?, prWorkflowEnabled? }`
- **Response:** 201 `{ success, ...launchResult }` or 500 `{ error }`.

### `GET /api/projects/[slug]`
Single project with recent audits + activity.
- **Request:** path `slug`
- **Response:** `Project` with `auditSnapshots` (last 10) and `activityEvents` (last 20). Marks audits read as a side effect.
- **Notes:** 400 on invalid slug, 404 if missing.

### `PATCH /api/projects/[slug]`
Update allowlisted project fields.
- **Request:** body keys filtered to: `status, currentPhase, currentRequest, health, healthDetails, autonomyMode, agentTeamsEnabled, prWorkflowEnabled, stack, progressScore, progressDetails, deploymentInfo, businessStage, projectContext, completionCriteria, badges, deadline, lastSessionEndedAt`. Enum-validated; bad values dropped silently.
- **Response:** updated `Project`. 400 if no valid fields.

### `GET /api/projects/[slug]/sessions`
Recent Claude session logs from disk.
- **Request:** path `slug`, query `limit?` (default 10)
- **Response:** `SessionLog[]` from `getSessionLogs(project.path, limit)`.

### `GET /api/projects/[slug]/work`
Structured remaining-work view: phases, requests, completion state.
- **Request:** path `slug`
- **Response:** result of `getRemainingWork(path, currentPhase, currentRequest)`.

### `POST /api/projects/[slug]/chat`
Streaming SSE chat scoped to a single project.
- **Request:** `{ messages: ChatMessage[] }` (validated)
- **Response:** Anthropic SSE stream (text/event-stream). Uses Sonnet, system prompt cached ephemerally, 60s abort, usage tap logs to `anthropic-usage-log`.
- **Notes:** rate-limited 20/min. 404 if project missing.

### `POST /api/projects/[slug]/dispatch`
Dispatch a Claude Code session for a single project.
- **Request:** `{ mode: "continue"|"audit"|"investigate"|"custom", prompt?: string }`
- **Response:** `{ success, mode, error?, idempotencyKey, dispatchId }`. On success, writes a `session-launched` activity event and updates `currentRequest`.
- **Notes:** rate-limited 10/min.

---

## Dispatch (fleet-wide)

### `POST /api/dispatch/all`
Dispatch every active project in one mode.
- **Request:** `{ mode?: "continue"|"audit" }` (default `"continue"`; other modes rejected)
- **Response:** result of `dispatchAll(prisma, mode)`.
- **Notes:** rate-limited 3/min.

### `POST /api/dispatch/batch`
Tmux-grid batch with per-project modes.
- **Request:** `{ items: [{ slug, mode, prompt? }, ...] }`. Items with invalid mode are dropped; empty list → 400.
- **Response:** `dispatchBatch` result.
- **Notes:** rate-limited 3/min.

### `POST /api/dispatch/team`
Lead Claude coordinating agent teams across projects.
- **Request:** same shape as `/dispatch/batch`.
- **Response:** `dispatchTeam` result.
- **Notes:** rate-limited 3/min.

---

## Overseer (Delamain)

### `POST /api/overseer/chat`
Streaming SSE chat with the Overseer; tool-use loop with the default registry.
- **Request:** `{ messages: ChatMessage[], sessionDate?: "YYYY-MM-DD" }`
- **Response:** synthetic SSE envelope (one `message_start` / text block / `message_stop`) wrapping potentially many Anthropic calls. Tool calls emit synthetic `tool_call_start` events; text deltas pass through.
- **Notes:** rate-limited 20/min. Slash commands `/anthropic-feature-check` and `/anthropic-feature-propose [slug...]` short-circuit into deterministic report responses. 60s abort. Engineer-channel writeback fires off the aggregated text after stream close. Bound to a daily `ChatSession`.

### `GET /api/overseer/session-state`
Read-only view of the day's ChatSession (Phase 16 contract).
- **Request:** query `sessionDate?` (YYYY-MM-DD, defaults to today UTC)
- **Response:** `{ exists: true, sessionId, sessionDate, startedAt, closedAt, activeFlow, workingMemory }` or `{ exists: false, sessionDate }`.
- **Notes:** `Cache-Control: no-store` always. 400 on malformed date.

### `GET /api/overseer/history`
Chat messages for a session date.
- **Request:** query `date?` (defaults to today)
- **Response:** `ChatMessage[]` ordered ascending by `createdAt`.

### `POST /api/overseer/history`
Persist a chat message.
- **Request:** `{ role, content, sessionDate? }`
- **Response:** 201 with created `ChatMessage`.

### `DELETE /api/overseer/history`
Clear history for a date.
- **Request:** query `date?` (defaults to today)
- **Response:** `{ ok: true }`.

### Tool framework

Tool registry, working-memory shape, and built-in read/write tools are documented inline in this file's older section below — see *Tool Framework* and *Built-in tools* for the canonical schemas; nothing has moved.

---

## Knowledge

### `GET /api/knowledge`
All lessons newest-first.
- **Response:** `KnowledgeLesson[]` with `sourceProject{name,slug}`.

### `POST /api/knowledge/harvest`
Harvest lessons from all projects (filesystem-based, no Claude).
- **Request:** none
- **Response:** `harvestKnowledge` result `{ newLessons, ... }`.
- **Notes:** rate-limited 5/min.

### `POST /api/knowledge/harvest-history`
Retroactive Claude-driven harvest from git/session history.
- **Request:** `{ slug? }`. If omitted, harvests all projects.
- **Response:** per-project `retroHarvestProject` result, or aggregated `{ projects[], totalLessons, totalDuplicates, totalProjects }`.
- **Notes:** Requires `ANTHROPIC_API_KEY`. 404 if slug missing.

### `GET /api/knowledge/search`
In-memory scored search across title/content/tags.
- **Request:** query `q` (≤200 chars; empty → `[]`)
- **Response:** `(KnowledgeLesson & { score })[]` sorted desc.

### `GET /api/knowledge/gaps`
Detected knowledge gaps from `detectKnowledgeGaps`.
- **Response:** gap report.

---

## Tasks / Reminders

### `GET /api/tasks`
List human tasks, optionally filtered.
- **Request:** query `status?`, `projectSlug?`, `category?` (enum-validated)
- **Response:** `HumanTask[]` ordered pending-first, priority alphabetical (high < low < normal), then newest.

### `POST /api/tasks`
Create a human task.
- **Request:** `{ title, category?, priority?, projectSlug?, createdBy? }` (defaults: `other`, `normal`, `user`)
- **Response:** 201 `HumanTask`.

### `PATCH /api/tasks`
Update task status / priority / category.
- **Request:** `{ id: number, status?, priority?, category? }`. Status=`done` sets `completedAt`; reverting to pending clears it.
- **Response:** updated `HumanTask`. 400 if no valid fields.

### `DELETE /api/tasks`
Delete a task.
- **Request:** `{ id: number }`
- **Response:** `{ ok: true }`.

### `GET /api/reminders`
Run condition checks, then return non-dismissed reminders.
- **Response:** `Reminder[]` ordered by status then `createdAt` desc.

### `POST /api/reminders`
Create a reminder.
- **Request:** `{ message, conditionType, conditionValue, projectSlug?, createdBy? }`
- **Response:** 201 `Reminder`.

### `PATCH /api/reminders`
Update reminder status.
- **Request:** `{ id, status }`. Setting `triggered` stamps `triggeredAt`.
- **Response:** updated `Reminder`.

### `GET /api/attention`
Aggregate counts for the dashboard attention badge.
- **Response:** `{ total, breakdown: { pendingTasks, blockedProjects } }`.

### `GET /api/activity`
Recent activity events.
- **Request:** query `type?`, `limit?` (default 20, max 100)
- **Response:** `ActivityEvent[]` with `project{name,slug}`, newest first.

---

## Reports / Advisories / Playbook / Briefing

### `POST /api/reports/generate`
Generate a single-project or cross-project report.
- **Request:** `{ type: "single"|"cross-project", slug?, format?: "markdown"|"pdf" }`. `slug` required when `type=single`.
- **Response:** markdown → `{ report, markdown }`. PDF → `application/pdf` binary with `Content-Disposition: attachment`.

### `POST /api/advisories/generate`
Run advisory engine across projects.
- **Request:** none
- **Response:** `generateAdvisories` result.
- **Notes:** rate-limited 5/min.

### `GET /api/playbook`
Read `knowledge/overseer-playbook.md`.
- **Response:** `{ content: string }` (empty string if missing).

### `PUT /api/playbook`
Overwrite the playbook file.
- **Request:** `{ content: string }`
- **Response:** `{ success: true }`.

### `GET /api/playbook/suggestions`
Pattern-mine recent session logs across `building`/`complete` projects for playbook additions.
- **Response:** `{ totalSessionsAnalyzed, projectsAnalyzed, suggestions }`.

### `POST /api/briefing`
Generate a morning briefing via Claude Haiku.
- **Request:** none
- **Response:** `{ briefing, generatedAt, projectCount, blockedCount, recentEventCount }`.
- **Notes:** rate-limited 5/min. Requires `ANTHROPIC_API_KEY`. 30s abort. Logs usage telemetry.

---

## Feature Proposals

### `GET /api/feature-proposals`
List proposals newest-first with feature + project inlined.
- **Request:** query `status?`, `project?` (slug), `limit?` (1–200, default 50)
- **Response:** `{ count, limit, proposals }`. 404 if project slug missing, 400 on bad status.

### `GET /api/feature-proposals/[id]`
Single proposal with feature + project.
- **Response:** `{ proposal }` or 404.

### `PATCH /api/feature-proposals/[id]`
Record resolution.
- **Request:** `{ status: "proposed"|"accepted"|"rejected"|"applied", notes?, resolvedBy? }`. Terminal statuses (accepted/rejected/applied) stamp `resolvedAt`; reverting to `proposed` clears it.
- **Response:** `{ proposal }`. 400 on validation, 404 if missing.

---

## Templates

### `GET /api/templates`
All kickoff templates newest-first.
- **Response:** `KickoffTemplate[]`.

### `POST /api/templates`
Create a template. Setting `isDefault: true` un-flags the previous default.
- **Request:** `{ name, content, description?, projectType?, isDefault? }`
- **Response:** 201 `KickoffTemplate`.

### `PATCH /api/templates`
Update by id (id in body, not URL).
- **Request:** `{ id, ...fields }`. Setting `isDefault: true` un-flags the previous default.
- **Response:** updated `KickoffTemplate`.

### `DELETE /api/templates`
Delete by id (id in body, not URL).
- **Request:** `{ id }`
- **Response:** `{ success: true }`.

---

## Integrations

### `GET /api/integrations/auth`
Status of vercel / github / railway / 1password CLIs.
- **Response:** array of `{ service, authenticated, ... }` from `checkAllAuthStatuses`.

### `POST /api/integrations/auth`
Launch a Terminal window running the service's login command.
- **Request:** `{ service: "vercel"|"github"|"railway"|"1password" }`
- **Response:** `{ ok: true, service }` or 500 with launch error.

### `POST /api/integrations/github`
Create a GitHub repo via `gh`.
- **Request:** `{ name, isPrivate?, description? }` (`isPrivate` defaults true)
- **Response:** 201 `{ url }`, 401 if `gh` unauthenticated, 409 on conflict.

### `GET /api/integrations/onepassword`
1Password env-var status for a project.
- **Request:** query `path`, `name` (path validated by `isInsideProjectsDir`)
- **Response:** `{ authenticated: true, vars }` or 401 / 403.

### `POST /api/integrations/onepassword`
Create vault item or populate `.env.local`.
- **Request:** `{ action: "create"|"populate", projectPath, projectName, vars? }`
- **Response:** result of `createVaultItem` or `populateEnvLocal`.
- **Notes:** 401 if `op` CLI unauthenticated. Vault hardcoded to `"Cascade"`.

### `GET /api/integrations/deploy-status`
Deployment status from Vercel or Railway.
- **Request:** query `platform: "vercel"|"railway"`, `projectId`
- **Response:** `getDeploymentStatus` result. 400 on missing/invalid params.

---

## Channels

### `GET /api/engineer-channel`
Read `.claude/engineer-channel.md` (falls back to legacy `kilroy-channel.md`).
- **Response:** `{ content: string }` (empty if neither exists).

### `POST /api/engineer-channel`
Append a timestamped message.
- **Request:** `{ from: "engineer"|"overseer"|"kilroy"|"delamain", message: string }`
- **Response:** `{ ok, sender, timestamp }`. Creates the file with a header if absent.

### `GET /api/kilroy-channel`
Legacy alias — read `.claude/kilroy-channel.md`.
- **Response:** `{ content: string }`.

### `POST /api/kilroy-channel`
Legacy alias — append to kilroy-channel.
- **Request:** `{ from: "kilroy"|"delamain", message: string }`
- **Response:** `{ ok, sender, timestamp }`.

---

## Wizard / Hooks / Preflight / Webhook

### `POST /api/wizard/chat`
Streaming SSE chat for the project-creation wizard.
- **Request:** `{ messages: ChatMessage[], templateContent: string }`
- **Response:** Anthropic SSE stream (Sonnet). Usage tap logs to `anthropic-usage-log`.
- **Notes:** rate-limited 20/min. 60s abort. Requires `ANTHROPIC_API_KEY`.

### `POST /api/hooks/validate`
Scan + repair every project's `.claude/settings.json` hook format (flat → nested).
- **Request:** none
- **Response:** `{ totalRepairs, repairedProjects, totalProjects, results: HookRepairResult[] }` where each result is `{ project, slug, status: "ok"|"repaired"|"no-settings"|"error", repairsCount, error? }`.

### `GET /api/preflight`
Live dispatch preflight (PATH checks for tmux/claude/etc).
- **Response:** `checkDispatchPreflight` result.
- **Notes:** `Cache-Control: no-store`.

### `GET /api/recommendations`
Phase 40 [P3] — outcome-driven dispatch recommendations for the dashboard.
- **Response:** `{ recommendations: Recommendation[] }` (see `lib/dispatch-recommendations.ts`).
- **Notes:** Reads `DispatchOutcome` rows from the last 14 days, groups by project, runs the pure `computeRecommendations` engine. `Cache-Control: no-store`. Phase 41.2: rows feed `goalAchieved` into the engine — the failing-mode rule scores goal-weighted successes (goal-verified 1.0 > self-reported 0.6 > evaluator-contradicted 0).

### `POST /api/webhook/session-complete`
Receives Claude Code Stop-hook pings from managed projects.
- **Request:** `{ projectPath: string, idempotencyKey?: string }`
- **Response:** `{ ok, slug, name, action, idempotencyKey?, importError? }`. Deduped responses return `{ ok, deduped: true, slug }` when the dispatch is already completed.
- **Notes:** Correlates by `idempotencyKey` (canonical) with legacy fallback via newest `session-launched` activity event. Side effects: targeted re-import of the project, dispatch-queue slot release, Dispatch row → `completed`, `session-complete` (or `orphaned-webhook`) activity event, escalation detection from latest session log → auto-creates `HumanTask` rows from `[HUMAN TODO]` signals (dedup on `projectSlug+title` when dispatch in scope), records a `DispatchOutcome` (success | attention-needed | test-failure | blocker), refreshes per-project feature-usage ledger. All best-effort: failures are logged but don't fail the webhook.
- **Phase 41.2 (goal state):** the outcome row also records `goalCondition` (recovered from the matched Dispatch's prompt snapshot — the `/goal` line the dispatcher composed from the request's acceptance criteria; null for ad-hoc dispatches and on the legacy path), plus `goalAchieved`/`goalReason` parsed defensively from the session log via `lib/dispatch-goals.ts#parseGoalOutcome` (markers: `[GOAL ACHIEVED]` / `[GOAL NOT ACHIEVED]` or prose "goal achieved/not achieved"; last verdict wins; no marker → null, never throws).

---

## Overseer Tool Framework (canonical)

`Tool<TInput, TOutput>` shape:
- `name: string` (unique within a registry)
- `description: string` (sent to the model)
- `inputSchema: Record<string, unknown>` (JSON Schema; Anthropic validates inputs)
- `handler: (input, ctx) => Promise<output>`

`ToolContext`: `{ prisma: PrismaClient; sessionId?: string }`. Tools that read or write working memory require `sessionId`.

`ToolRegistry`: `register`, `get`, `has`, `list`, `toAnthropicTools`, `execute`. Handler errors are wrapped as `{ ok: false, error }` so the loop never crashes on a single tool fault.

`runToolUseLoop({caller, model, systemPrompt, messages, registry, ctx, maxIterations, maxTokens})`: pure async loop. Returns `{ messages, finalText, toolCallsExecuted, truncated }`. Bails at `maxIterations` (default 8) with `truncated: true`. Tool errors flow back to the model as `tool_result` blocks with `is_error: true`.

### Built-in tools

**Read tools (no side effects)**

| Name | Input | Output |
|------|-------|--------|
| `query_project` | `{ slug }` | Single-project state |
| `query_projects` | `{ status?, health?, includeBackburner?, limit? }` | Filtered fleet list |
| `get_recent_activity` | `{ projectSlug?, eventType?, limit? }` | Newest-first activity events |
| `get_session_logs` | `{ slug, limit? }` | Recent Claude session logs |
| `get_dispatch_outcomes` | `{ projectSlug?, mode?, limit? }` | Per-mode totals + recent failures |
| `get_yesterday_summary` | `{ daysAgo?, perMessageMaxChars? }` | Last 3 assistant messages from a prior date |
| `get_engineer_messages` | `{ maxChars? }` | Recent engineer-channel content |
| `get_playbook` | `{ bullets? }` | overseer-playbook.md (full or rules-only) |
| `get_session_state` | `{}` | `{ sessionId, activeFlow, workingMemory }` |

**Write tools (mutate state)**

| Name | Input | Side effects |
|------|-------|--------------|
| `update_session_memory` | `{ patch }` | Deep-merges into `chatSession.workingMemory`. Throws via tool error if session is closed or `ctx.sessionId` missing. |
| `set_active_flow` | `{ flow: "inventory_walk"\|"dispatch_planning"\|"incident_triage"\|null }` | Writes `chatSession.activeFlow`. |
| `propose_dispatch` | `{ slug, mode, instructions? }` | Appends to `workingMemory.proposedDispatches`. |
| `create_reminder` | `{ conditionType, conditionValue, message, projectSlug? }` | Creates a Reminder row (`createdBy: "delamain"`). |
| `create_human_todo` | `{ title, projectSlug?, category?, priority? }` | Creates a HumanTask row (`createdBy: "delamain"`); resolves projectSlug to projectId when possible. |

**Working-memory shape (canonical)**

`chatSession.workingMemory` is a JSON document. Keys used by the defaults today:
- `covered: { [slug]: { progress?, blocker?, note? } }` — confirmed during inventory walks
- `proposedDispatches: [{ slug, mode, instructions?, proposedAtISO }]`
- (free-form for anything else the model wants to record)
