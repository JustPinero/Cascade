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
