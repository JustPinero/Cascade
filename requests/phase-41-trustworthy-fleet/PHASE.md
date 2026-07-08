# Phase 41 — Trustworthy Fleet

Everything in this phase comes from findings during the 2026-07-07 v4.0
fleet migration: Cascade believed things about the fleet that weren't
true, trusted sessions' self-reports, lost webhook pings silently, let
ephemeral session files leak into a public repo for months, and kept
its learnings on one machine.

**Theme: Cascade should verify, not trust — and its picture of the
fleet should survive contact with reality.**

## Requests (execution order)

| # | Request | Why this order |
|---|---|---|
| 41.1 | Suite green + test-rig hygiene | Can't run a TDD phase on a suite with 3 pre-existing failures |
| 41.2 | Goal-driven dispatch outcomes | Highest value: makes the whole feedback loop trustworthy |
| 41.3 | Publish-safety & secret-hygiene audit | Prevents the incident class that cost a history rewrite |
| 41.4 | Fleet reconciliation in health engine | DB vs disk vs origin truth; multi-machine awareness |
| 41.5 | Session-complete webhook resilience | Stop losing pings when the server is down |
| 41.6 | Lesson sync to kilroy-brain | Learnings become portable across machines |
| 41.7 | Infrastructure-version health dimension | Plugin/migration/trust state per project |

Dependencies: 41.4 and 41.7 both extend the health engine — 41.7
builds on 41.4's reconciliation plumbing. 41.3 is standalone. 41.2
touches dispatcher + DispatchOutcome only.

## Exit criteria

- All seven requests: acceptance criteria met, tests green,
  `scripts/validate.sh` passes.
- Zero pre-existing test failures remain (41.1 makes the suite honest).
- Morning briefing and fleet dashboard surface the new signals
  (reconciliation drift, publish-safety findings, goal-verified
  outcomes, infra versions).
- `/coqui-kickoff:phase-complete` audits run at phase end; findings
  become phase-41-fixes requests before merge to main.
