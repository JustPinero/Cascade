# Request 43.1 — Identity & Teams Domain Model

First increment of the Cascade Teams overhaul (`docs/cascade-2.0-team-direction.md`).
Establishes the multi-user identity primitives. **Architecture-independent** — no
auth mechanism and no Postgres decision required to land this correctly; those are
later, gated phases. Everything here is additive and backward-compatible: existing
single-user data has no team and keeps working.

## Scope
Four models + one domain service. NOT in scope: auth/sessions (Phase 3), attaching
ownership to Dispatch/HumanTask/Project (Phase 2 — 43.2), UI (later), Postgres (Phase 5).

## Models (prisma/schema.prisma)
- `User` — a person. `id`, `email @unique`, `name`, `createdAt`.
- `Team` — a workspace. `id`, `name`, `slug @unique`, `createdById`, `createdAt`.
- `Membership` — join row. `userId`, `teamId`, `role` (owner|admin|member|viewer),
  `createdAt`; `@@unique([userId, teamId])`, indexed by team.
- `Invite` — pending invitation. `id`, `teamId`, `email`, `role`, `token @unique`,
  `invitedById`, `status` (pending|accepted|revoked|expired), `expiresAt`, `createdAt`.

## Domain service (lib/teams.ts) — Prisma injected, following webhook-ingest pattern
- `createTeam(prisma, { name, owner })` → team + owner Membership(role=owner), unique slug.
- `inviteMember(prisma, { team, email, role, invitedBy, now?, ttlMs? })` → Invite with a
  crypto-random single-use token; re-inviting a pending email refreshes, doesn't duplicate.
- `acceptInvite(prisma, { token, user, now? })` → Membership; marks invite accepted;
  rejects expired/revoked/already-accepted tokens.
- `addMember`, `listMembers(team)`, `roleOf(user, team)`, `isMember`, `listTeams(user)`.

## Acceptance Criteria → Tests (write FIRST)
| # | Criterion | Test |
|---|-----------|------|
| 1 | createTeam creates team + owner membership; slug unique/derived | lib/teams.test.ts "creates a team with an owner membership" |
| 2 | Duplicate team name yields a distinct unique slug | lib/teams.test.ts "disambiguates slugs" |
| 3 | inviteMember creates a pending single-use token invite | lib/teams.test.ts "invites by email with a token" |
| 4 | Re-inviting a pending email refreshes rather than duplicating | lib/teams.test.ts "re-invite refreshes, no dupes" |
| 5 | acceptInvite adds membership + marks accepted; token can't be reused | lib/teams.test.ts "accept adds member and burns the token" |
| 6 | Expired / revoked invites are rejected | lib/teams.test.ts "rejects expired and revoked invites" |
| 7 | roleOf / isMember reflect membership; non-members get null/false | lib/teams.test.ts "role + membership checks" |
| 8 | listTeams returns a user's teams; listMembers returns a team's people | lib/teams.test.ts "listing teams and members" |

## Validate
`scripts/validate.sh` green. `pnpm exec prisma db push` after schema edits (regenerates client + syncs dev.db; test template picks it up).
