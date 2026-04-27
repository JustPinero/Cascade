# Anthropic Feature Catalog (Seed)

**Purpose.** Curated catalog of Claude / Claude Code features that
Cascade tracks against every managed project. Used by request
11.1 (Anthropic Feature Update Check) as the ground-truth source for
the on-demand audit.

**Editing rules.**
- Add new entries by appending a new `## ` block following the schema
  below.
- Don't remove entries — mark them deprecated with `**Deprecated**:
  reason` if they go away upstream.
- The catalog parser (`lib/anthropic-features-md.ts`) reads this file
  on Cascade startup and upserts rows in the `UpstreamFeature` table.
  Hand-edit here, not the DB.

## Entry schema

Each `## ` block describes one feature. The required fields are
declared as Markdown definition lists (`Field: value`). Free-form
prose under the block is captured as `description`.

```
## Feature Name
- **Vendor**: anthropic
- **Category**: hook | skill | slash-command | mcp-server | sub-agent |
                agent-team | settings-flag | sdk-feature | api-feature |
                memory | other
- **Source**: <URL or "manual">
- **Confidence**: 0–100 (curated entries default 100)
- **Detector**: function name in lib/anthropic-feature-detectors.ts
                that emits true when a project uses this feature
                ("none" if not yet implemented)

(free-form description and integration recipe below the field block)
```

---

## Stop Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsStopHook

A Claude Code hook that fires when a session ends. Configured under
`hooks.Stop` in `.claude/settings.json`. Cascade installs one across
every project to ping the session-complete webhook; Justin's setup
also chains a sound and a `harvest.sh --auto` call.

**Integration recipe**: install via `pnpm exec tsx scripts/install-hooks.ts`
in the Cascade repo. Adds the hook to every dispatch-ready project's
`.claude/settings.json` without overwriting other hook entries.

## PostCompact Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsPostCompactHook

Fires when Claude Code auto-compacts the conversation. Cascade uses it
for context-recovery messaging — printing a "re-read CLAUDE.md and
current request" banner so the next turn picks up cleanly.

**Integration recipe**: append a `PostCompact` entry to `.claude/settings.json`
hooks. The current pattern in Cascade settings.json is the working example.

## PreToolUse Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsPreToolUseHook

Fires before any tool call (Bash, Edit, Write, etc.). Common uses:
secret-scanning before commit, blocking dangerous commands, prompting
for confirmation on destructive operations.

**Integration recipe**: scope via `matcher` (e.g. `Bash`). Cascade's
secret-scanner pattern in settings.json is a working example.

## PostToolUse Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsPostToolUseHook

Fires after every tool call. Common uses: auto-format on Write/Edit,
log changes to an audit trail, run lint after file save.

**Integration recipe**: matcher `Write|Edit` is the common case.
Cascade's auto-prettier pattern is the canonical example.

## UserPromptSubmit Hook
- **Vendor**: anthropic
- **Category**: hook
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsUserPromptSubmitHook

Fires when the user submits a prompt. Cascade's projects use this to
auto-run validation when the prompt mentions "prime for" — surfacing
test failures before any work begins.

**Integration recipe**: regex matcher on prompt content. The "prime
for" pattern in Cascade settings.json is the working example.

## Slash Commands (`.claude/commands/`)
- **Vendor**: anthropic
- **Category**: slash-command
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsSlashCommands

User-defined slash commands stored as Markdown files in
`.claude/commands/`. Each file is a reusable workflow Claude can
invoke (e.g. `/handoff`, `/audit`, `/phase-complete`). Cascade ships
~10 of these in its kickoff template.

**Integration recipe**: drop a `.claude/commands/<name>.md` file with
the command's instructions; Claude picks it up automatically.

## Skills (`.claude/skills/`)
- **Vendor**: anthropic
- **Category**: skill
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsSkills

User-defined skills stored as `.claude/skills/<name>/SKILL.md`. Each
skill is a domain capability with structured invocation. Cascade
projects use skills for audits (bughunt, drift-audit, optimize, etc.).

**Integration recipe**: create a `SKILL.md` with a frontmatter block
declaring inputs/outputs and the skill's instructions.

## Sub-Agents (Task tool)
- **Vendor**: anthropic
- **Category**: sub-agent
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsSubAgentUsage

The Task tool lets a Claude session spawn specialized sub-agents
(general-purpose, code-reviewer, Explore, etc.). Used for parallel
research and protecting the main context window.

**Integration recipe**: in any session, call the Task tool with
`subagent_type` and a self-contained `prompt`. Sub-agent doesn't
inherit conversation context, so the prompt must brief it from
scratch.

## Agent Teams
- **Vendor**: anthropic
- **Category**: agent-team
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsAgentTeams

A multi-agent dispatch pattern: a lead Claude orchestrates teammates
working on related concerns in parallel. Cascade's
`lib/claude-dispatcher.ts` `dispatchTeam` is the canonical
implementation — lead + N teammates in a tmux grid.

**Integration recipe**: requires CLAUDE.md to declare team
composition + lead role. Cascade's kickoff template can opt projects
into team mode by adding `agentTeamsEnabled: true` to the project row.

## MCP Servers
- **Vendor**: anthropic
- **Category**: mcp-server
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsMCPServers

Model Context Protocol servers extend Claude Code with custom tools
exposed by external processes. Cascade itself doesn't use any
custom MCP servers yet (relies on the built-in Bash/Edit/Write
toolset), but managed projects sometimes do.

**Integration recipe**: configure in `.claude/settings.json`
`mcpServers` block. Server can be a local process or HTTP endpoint.

## Memory / Auto-Memory
- **Vendor**: anthropic
- **Category**: memory
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsAutoMemory

The auto-memory system stores per-conversation observations
(user profile, feedback, project state) as Markdown files in
`~/.claude/projects/<project>/memory/`. Loaded on every session
load.

**Integration recipe**: use the `Write` tool to update files in
the memory directory. `MEMORY.md` is the index; per-topic files
live alongside it. Cascade's user_profile.md is the working
example.

## Plan Mode
- **Vendor**: anthropic
- **Category**: settings-flag
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsPlanModeUsage

A mode where Claude plans the implementation strategy before
executing. Useful for non-trivial tasks where the plan should be
reviewed before any code changes.

**Integration recipe**: invoke via `EnterPlanMode` / `ExitPlanMode`
in agent tools, OR use the Plan agent type for design-first work.

## Status Line
- **Vendor**: anthropic
- **Category**: settings-flag
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsStatusLine

Custom status line shown in the Claude Code CLI footer. Configurable
via `.claude/settings.json` `statusLine` field.

**Integration recipe**: drop a `statusLine` block in `.claude/settings.json`
with a shell command whose stdout becomes the status line.

## IDE Integrations (VS Code / JetBrains)
- **Vendor**: anthropic
- **Category**: settings-flag
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsIDEIntegration

Claude Code can be invoked from IDEs with project context auto-loaded.
Less relevant for headless Cascade dispatch but worth tracking for
projects where the user iterates inside an IDE.

**Integration recipe**: install the Claude Code extension in the IDE.
No project-side config required.

## Background Tasks (`run_in_background`)
- **Vendor**: anthropic
- **Category**: settings-flag
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsBackgroundTaskUsage

The `Bash` tool's `run_in_background` flag lets long-running
processes survive past the request that started them. Cascade uses
this for the dev server start.

**Integration recipe**: pass `run_in_background: true` when invoking
Bash. Use `Monitor` tool to read output, `BashOutput` for
already-running processes.

## Worktree Isolation (Agent tool)
- **Vendor**: anthropic
- **Category**: sub-agent
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsWorktreeAgents

The `Agent` tool's `isolation: "worktree"` option spawns a sub-agent
in a temporary git worktree, so it works on an isolated copy of the
repo. Useful for risky refactors that should be reviewed before
landing.

**Integration recipe**: pass `isolation: "worktree"` to an Agent
call. The sub-agent's branch + path are returned in the result for
later merging.

## Prompt Caching (API)
- **Vendor**: anthropic
- **Category**: api-feature
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsPromptCaching

A request-level optimization that reuses repeated prompt prefixes
across calls. Drops cost ~90% and latency ~85% for the cached
portion. Useful for system prompts > 1024 tokens.

**Integration recipe**: add `cache_control: {type: "ephemeral"}` to
the long-prefix block in your messages array. Cascade's Overseer
chat would benefit (large system prompt with project list, dispatch
outcomes, conversation memory) — currently NOT used in
`app/api/overseer/chat/route.ts`.

## Extended Thinking (API)
- **Vendor**: anthropic
- **Category**: api-feature
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsExtendedThinking

Lets Claude do longer-form reasoning before responding, surfaced as
a `thinking` content block. Useful for hard architectural questions.

**Integration recipe**: pass `thinking: {type: "enabled", budget_tokens: ...}`
in the API request. Anthropic SDK supports it natively; raw fetch
needs the field added manually.

## Batch API
- **Vendor**: anthropic
- **Category**: api-feature
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsBatchAPI

Submit multiple requests asynchronously, retrieve results when ready.
~50% cheaper than synchronous. Useful for harvesters and audit
sweeps.

**Integration recipe**: POST to `/v1/messages/batches`; poll status;
fetch results. Cascade's morning briefing or knowledge harvest could
use this if cost ever matters.

## Files API
- **Vendor**: anthropic
- **Category**: api-feature
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsFilesAPI

Upload files (PDFs, images) once, reference by ID across multiple
messages. Currently NOT used in Cascade.

**Integration recipe**: POST to `/v1/files`; reference returned `file_id`
in subsequent messages.

## Citations
- **Vendor**: anthropic
- **Category**: api-feature
- **Source**: manual
- **Confidence**: 100
- **Detector**: detectsCitations

When `documents` are passed in messages with citations enabled,
responses include source references. Useful for any RAG-style
workflow.

**Integration recipe**: pass `citations: {enabled: true}` per
document; parse the `citations` field on response content blocks.

---

**Footnotes.**
- This is a seed catalog. The harvester (extended in 11.1) will
  append `[ANTHROPIC]`-tagged entries from session handoffs as
  low-confidence candidates pending review.
- The conversion prompt for web-fetched candidates targets this same
  Markdown shape. Approved candidates from the review queue land here
  with `Source: <URL>`.
- Detectors marked `none` in this seed are not yet implemented in
  `lib/anthropic-feature-detectors.ts`. Implementing them is part of
  request 11.1 GREEN phase.
