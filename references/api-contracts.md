# API Contracts

## Projects

### GET /api/projects
Returns all projects with health indicators.

### POST /api/projects
Create a new project.

### POST /api/projects/scan
Trigger a filesystem scan of all projects.

### GET /api/projects/[slug]
Get a single project by slug.

### PATCH /api/projects/[slug]
Update a project.

---

## Knowledge

### GET /api/knowledge
Get all knowledge lessons.

### POST /api/knowledge
Create a new knowledge lesson.

### POST /api/knowledge/harvest
Trigger knowledge harvesting across all projects.

### GET /api/knowledge/search
Search knowledge lessons.

---

## Reports

### POST /api/reports/generate
Generate a PDF report (single-project or cross-project).

---

## Wizard

### POST /api/wizard/chat
Stream a Claude conversation for the project creation wizard.

---

## Templates

### GET /api/templates
Get all kickoff templates.

### POST /api/templates
Create a new template.

### PATCH /api/templates/[id]
Update a template.

### DELETE /api/templates/[id]
Delete a template.

---

## Integrations

### POST /api/integrations/github
Create a GitHub repository.

### GET /api/integrations/onepassword
Get 1Password env var status for a project.

### POST /api/integrations/onepassword
Populate .env.local from 1Password.

### GET /api/integrations/deploy-status
Get deployment status from Vercel/Railway.

---

## Overseer (Delamain)

### POST /api/overseer/chat
Streaming SSE chat with the Overseer. Body shape:

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "useTools": false
}
```

`useTools` (Phase 12A.3, opt-in): when `true`, the request is handled by the
tool-using path — `runToolUseLoop` over `buildDefaultRegistry()` with
`defaultAnthropicCaller`. Final assistant text is returned as a single SSE
chunk via `sseFromText`. When unset or `false`, the legacy SP-injection
streaming path runs unchanged.

### Tool Framework (lib/overseer-tools.ts)

`Tool<TInput, TOutput>` shape:
- `name: string` (must be unique within a registry)
- `description: string` (sent to the model)
- `inputSchema: Record<string, unknown>` (JSON Schema; Anthropic validates inputs)
- `handler: (input, ctx) => Promise<output>`

`ToolContext`: `{ prisma: PrismaClient; sessionId?: string }`. Tools that
read or write working memory require `sessionId`.

`ToolRegistry`: `register`, `get`, `has`, `list`, `toAnthropicTools`,
`execute`. Handler errors are caught and wrapped as
`{ ok: false, error }` so the loop never crashes on a single tool fault.

`runToolUseLoop({caller, model, systemPrompt, messages, registry, ctx, maxIterations, maxTokens})`:
pure async loop. Returns `{ messages, finalText, toolCallsExecuted, truncated }`.
Bails at `maxIterations` (default 8) with `truncated: true`. Tool errors
flow back to the model as `tool_result` blocks with `is_error: true`.

### Built-in tools (Phase 12 final state)

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
| `update_session_memory` | `{ patch }` | Deep-merges into `chatSession.workingMemory`. Throws via tool error if session is closed or `ctx.sessionId` is missing. |
| `set_active_flow` | `{ flow: "inventory_walk"\|"dispatch_planning"\|"incident_triage"\|null }` | Writes `chatSession.activeFlow`. |
| `propose_dispatch` | `{ slug, mode, instructions? }` | Appends to `workingMemory.proposedDispatches`. |
| `create_reminder` | `{ conditionType, conditionValue, message, projectSlug? }` | Creates a Reminder row (`createdBy: "delamain"`). |
| `create_human_todo` | `{ title, projectSlug?, category?, priority? }` | Creates a HumanTask row (`createdBy: "delamain"`); resolves projectSlug to projectId when possible. |

**Working-memory shape (canonical)**

`chatSession.workingMemory` is a JSON document. Keys used by the
defaults today:
- `covered: { [slug]: { progress?, blocker?, note? } }` — confirmed during inventory walks
- `proposedDispatches: [{ slug, mode, instructions?, proposedAtISO }]`
- (free-form for anything else the model wants to record)
