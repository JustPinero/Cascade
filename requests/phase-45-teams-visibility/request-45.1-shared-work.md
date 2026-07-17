# Request 45.1 — Shared Work Visibility (the collision-plane feed)

Phase 2 of the Teams overhaul (builds on 43.1). Attaches team + owner to work
items and provides the **unified activity feed** — the primitive the collision
board renders: every team member sees who (human or agent) is doing what.

Additive + backward-compatible: `teamId`/`ownerUserId` are nullable; existing
single-user dispatches/tasks are unaffected. Architecture-independent (no
auth/Postgres needed).

## Schema (done)
- `Dispatch.teamId?`, `Dispatch.ownerUserId?` (+ relations, `@@index([teamId])`)
- `HumanTask.teamId?`, `HumanTask.ownerUserId?` (+ relations, `@@index([teamId])`)

## Domain service (lib/team-activity.ts)
- `assignDispatchToTeam(prisma, { dispatchId, team, owner? })`
- `assignTaskToTeam(prisma, { taskId, team, owner? })`
- `listTeamActivity(prisma, team)` → normalized feed combining the team's
  dispatches (agents) and human tasks (people), each `{ kind, id, title,
  status, projectSlug, owner, at }`, newest first.
- `listMemberWork(prisma, { team, user })` → the feed filtered to one owner.

## Acceptance Criteria → Tests (write FIRST)
| # | Criterion | Test |
|---|-----------|------|
| 1 | Assigning a dispatch + a task to a team, then listing, returns BOTH kinds | lib/team-activity.test.ts "unified feed spans dispatches and tasks" |
| 2 | Each item carries kind, title, status, projectSlug, and resolved owner | lib/team-activity.test.ts "items are normalized + owner-attributed" |
| 3 | Work NOT assigned to the team is excluded | lib/team-activity.test.ts "excludes work outside the team" |
| 4 | listMemberWork returns only that member's owned items | lib/team-activity.test.ts "member work filter" |
| 5 | Feed is newest-first | lib/team-activity.test.ts "ordered newest first" |

## Validate
`scripts/validate.sh` green (existing Dispatch/HumanTask suites still pass — nullable fields are backward-compatible).
