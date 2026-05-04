# Session Handoff

## When to Use
Run at the end of every work session, before context is lost. Ensures the next Claude session can pick up exactly where you left off.

## Procedure

### 1. Summarize Work Completed
- List features/fixes implemented this session
- Note the request number(s) worked on
- List files created or significantly modified

### 2. Document Decisions
For each non-obvious decision made:
- What was decided
- Why (alternatives considered)
- Any tradeoffs accepted

### 3. Note Blockers and Open Questions
- Anything that couldn't be resolved this session
- Questions that need user input
- External dependencies (waiting on API access, etc.)

### 4. Update Handoff File
Write all of the above to `.claude/handoff.md` with this structure:

```markdown
# Session Handoff

## Last Session
Date: YYYY-MM-DD
Request: X.Y — Title

## Work Completed
- Item 1
- Item 2

## Files Changed
- path/to/file — what changed

## Decisions Made
- Decision: Why

## Open Items
- Blocker/question

## Next Steps
- What the next session should start with

## Current State
- Phase: N — Name
- Next Request: X.Y
- Branch: branch-name
- Tests: passing/failing (N failures)
```

## Operational gotchas to capture in handoff when relevant

### Schema-changing slices require a dev server restart
If your slice modified `prisma/schema.prisma`, the Turbopack dev server's
Prisma client is stale until the process restarts. Manual testing of any
new model / column will throw `TypeError: Cannot read properties of
undefined (reading '<method>')` on routes that touch the new shape.

When this applies, add this line to the handoff:

> **Restart required:** `prisma/schema.prisma` modified — kill the dev server PID and re-run `pnpm dev` before manual testing.

The next session sees that note before they spend 10 minutes hunting a
ghost bug.

### Anything else that requires user-side action between sessions
Migrations applied to one DB but not another, hooks that need a refresh
sweep (`pnpm tsx scripts/install-hooks.ts`), env-var changes — call them
out under a **Restart / refresh** subsection so they don't get lost in
the body.
