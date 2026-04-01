# Overseer Playbook

How I want my projects handled. These preferences are included in every dispatch prompt.

## General Rules
- Always run tests before committing
- Never push to main without all tests passing
- Follow the action loop: Prime → Plan → Execute → Validate
- Update .claude/handoff.md at the end of every session
- Log any new debt to audits/debt.md immediately
- If you hit a blocker, write a diagnosis and stop — don't spin

## Code Standards
- TypeScript strict mode, no `any` types
- Server components by default in Next.js
- Tailwind for styling, no inline styles
- All async operations properly awaited

## Communication
- Be concise in commit messages
- Tag lessons with [LESSON] in handoff notes
- If the project has no CLAUDE.md or requests, say so and stop

## When Stuck
- Don't retry the same approach more than twice
- If tests fail after fixing, write the failure to handoff and stop
- Ask for help by writing to .claude/handoff.md with [NEEDS ATTENTION] tag

## Project-Specific Overrides
<!-- Add per-project rules here like:
- ratracer: always run seed after schema changes
- pointpartner: check Stripe webhooks after deploy
-->
