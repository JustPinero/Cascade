# Overseer Playbook

How I want my projects handled. These preferences are included in every dispatch prompt.

## Testing Protocol (HIGHEST PRIORITY)
- ALWAYS write failing tests FIRST from the acceptance criteria before writing any implementation code
- Follow Red → Green → Refactor: (1) write tests that fail, (2) implement until they pass, (3) clean up
- Every acceptance criterion in the request file must map to at least one test
- Run `pnpm test` after writing tests to confirm they FAIL — if they pass before implementation, the tests are too weak
- No request is complete without tests. No exceptions.
- If the project has no test framework, set one up before doing anything else

## General Rules
- Follow the action loop: Prime → Plan → Red → Green → Validate
- Always run tests before committing
- Never push to main without all tests passing
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
