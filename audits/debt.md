# Technical Debt Log

## Open

### [10.5] Pre-existing build failure on /create page — 2026-04-26
`pnpm build` fails with "TypeError: Cannot read properties of null (reading 'useContext')" when
prerendering `/create`. Confirmed pre-existing before 10.5 work (fails on clean branch too).
Likely a React context issue in the project creation wizard that emerged from a Next.js version
bump. Does not affect dev server, tests, lint, or typecheck. CI `build` job will catch this on
next push. Fix: investigate `app/create/page.tsx` for improper hook usage outside a provider.

## Resolved

### [10.1] Queue integration for multi-project dispatch — RESOLVED 2026-04-19
`dispatchAll`, `dispatchBatch`, and `dispatchTeam` now route through the
`DispatchQueue` singleton. Option B shipped: pane grid is created upfront
with "[queued: projectname]" placeholders, and `tmux respawn-pane -k`
replaces each placeholder with the real Claude command as the queue releases
slots. Users see the full grid immediately even on low-RAM hosts; Claude
processes are gated by memory-appropriate concurrency. `dispatchTeam`'s
single lead-agent spawn takes exactly one queue slot. 3 integration tests
in `lib/claude-dispatcher.multi.test.ts` verify enqueue counts + IDs.

**Open follow-up (smaller):** dashboard UI indicator for "N running, M queued"
so users can see queue state for multi-dispatch without looking at tmux.
Not urgent — tmux "[queued]" placeholders already communicate this at the
terminal level.

## In Progress

_No items in progress._

## Resolved

_No resolved items yet._
