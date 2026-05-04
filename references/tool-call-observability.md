# Tool-Call Observability — instrument the Overseer's decisions

The Overseer ships 14 tools and we have zero introspection on which the model picks, in what order, with what success. Tool selection accuracy is the single most useful signal for debugging tool-using agent behavior, and we currently don't measure it.

## Schema

```prisma
model ToolCallEvent {
  id            Int         @id @default(autoincrement())
  sessionId     String                                          // ChatSession.id (Overseer chat path)
  iteration     Int                                             // 0-indexed turn within the tool-use loop
  toolName      String
  input         String                                          // JSON of the tool input as sent
  outputSize    Int                                             // length of stringified result, or 0 if errored
  success       Boolean
  errorMessage  String?
  durationMs    Int                                             // wall time for handler execution
  resultUsed    Boolean?    @default(true)                      // see "result-used heuristic" below
  createdAt     DateTime    @default(now())

  @@index([sessionId, createdAt])
  @@index([toolName])
  @@index([createdAt])
}
```

One row per call to `registry.execute(...)` inside `runToolUseLoop` (`lib/overseer-tools.ts:233`). Adding the row is one line in the loop body, immediately before pushing to `toolResultBlocks`.

## Result-used heuristic

A tool call is *useful* if the model's next assistant turn references its output. A tool call is *wasted* if the model called it and then ignored the result. We approximate this by: after the next model turn returns, if `result.success === true` and **none of the next assistant turn's text or tool inputs reference fields from the result**, mark `resultUsed = false`.

Heuristic-only — false positives are fine. The point is to surface a class like "model calls `get_engineer_messages` 3× per inventory walk and never uses the output," which is a tool design problem.

This is a Phase-24 polish item; ship the basic schema first without `resultUsed` and add it as a follow-up slice if the data is already valuable enough.

## Overseer tool surface

A new tool `get_tool_call_stats` lets the Overseer answer questions about its own behavior:

```ts
{
  name: "get_tool_call_stats",
  description: "Read tool-call telemetry. Useful when the developer asks about which tools you use, why a session hit the iteration limit, or whether a tool keeps failing.",
  input_schema: {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "default: current session" },
      windowDays: { type: "integer", description: "default: 7" },
      groupBy: { type: "string", enum: ["tool", "session", "iteration"], description: "default: tool" }
    }
  }
}
```

Returns aggregated counts and success rates. This is what makes the data useful at conversation time — "Hey Del, what's wrong with my session?" → Del calls `get_tool_call_stats({ sessionId: ... })` and answers concretely.

## /observability/tools page

A single Next.js page renders recent rows as a table. Columns: timestamp, sessionId (truncated, linkable), iteration, toolName, success, durationMs, outputSize. Filters: date range, toolName dropdown, success boolean, sessionId text input. No charts. No aggregations. Just rows.

The page server-component fetches the last 500 rows from Prisma. Pagination is the next-page link, not infinite scroll. If the table grows past usefulness, add a "tool usage by week" chart in a follow-up slice — demand-driven, per the rule.

Path: `app/observability/tools/page.tsx`. Uses existing dashboard chrome.

## Useful queries the data answers

- "Which tool gets called most this week, per session?" — `groupBy: tool, windowDays: 7`
- "Which tools fail most often?" — `success: false`, group by toolName
- "What's the median tool-call latency?" — sort durationMs
- "Did the model ever loop on `query_project` for the same slug 3× in one turn?" — group by `(sessionId, iteration, toolName, input.slug)`, count > 1
- "Has tool X ever been called?" — count by toolName, look for zeroes

The third and fourth surface tool design problems. The fifth surfaces dead tools (worth pruning, since each tool eats cache prefix tokens).

## Cost

One Prisma insert per tool call. Negligible. Storage grows linearly — a heavy week is maybe 5,000 rows. SQLite will not feel it.

## What we deliberately do NOT log

- Full output content. Storing every tool's full output bloats the DB and risks PII for tools that read engineer messages or session logs. We log `outputSize` (length) only. If a developer needs to see the actual output of a past call, they look at the corresponding `ChatMessage` (the tool result is preserved there) — not at this table.
- The full input for `update_session_memory` patches. Those can contain the entire working memory document. Truncate `input` to 4 KB before insert; mark with a flag if truncated.

## Why a separate model and not extending ChatMessage

`ChatMessage` is keyed to `ChatSession` and is the chat transcript. Adding tool-call telemetry there muddies the transcript model and forces every dashboard query to filter out tool rows. A separate `ToolCallEvent` table lets the chat transcript stay a clean transcript and lets observability queries hit a focused index.
