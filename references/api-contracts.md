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

### Built-in tools (Phase 12A.3)

| Name | Input | Output (when `found: true`) | Side effects |
|------|-------|------------------------------|--------------|
| `query_project` | `{ slug: string }` | `{ found, slug, name, status, health, phase, progressScore, businessStage, context?, completionCriteria?, currentRequest?, needsAttention?, lastSessionEndedAt?, progressBreakdown? }` | None (read-only) |
