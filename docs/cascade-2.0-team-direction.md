# Cascade 2.0 — The Team Direction

_Working brief, not a spec. Kilroy for Justin, July 2026. Companion prototype: the team collision board (published artifact)._

## 1. Thesis in one line
Cascade's edge was never that it runs agents — the platform commoditized that. Its edge is that it is the only system holding the **full picture of who is doing what**: every human assignment *and* every live agent dispatch, on one surface. Team Cascade is not a task tool with agents bolted on. It's the **collision plane** — the layer that keeps humans and agents from working over each other, with everyone on the same goal.

**Why only Cascade can build this:** Linear knows a person is assigned to an issue. It has no idea that person's Claude agent is editing the same files another teammate's agent is editing right now. Cascade already tracks agent dispatches as a state machine and already enforces "one agent per working tree." The team product is that safety rule, generalized to humans + agents, exposed as a feature.

## 2. The one real decision: integrate, don't rebuild
| Layer | Call | Why |
|---|---|---|
| Task management (board, issues, assignees) | **INTEGRATE — Linear first** | Teams already have this; owning it means competing with Jira/Linear. Sync from Linear; optional light native board for teams without one. |
| Agent execution (spawn/track sessions) | **ADOPT native primitives** | Claude Code agent teams + Agent SDK ship this now. Stop maintaining plumbing; sit above it. |
| Activity + collision overlay | **BUILD — the moat** | Nobody has unified human+agent "who's on what" with conflict detection. All differentiation goes here. |

Product = a thin layer over three inputs Cascade already reaches: (a) its own **Dispatch rows** = agents; (b) synced **Linear issues** = humans; (c) a shared **resource model** (task/dispatch → project → touched paths) that makes overlap detectable.

## 3. What the team sees
- **One board, two kinds of worker** — human and agent cards on the same project swimlanes; type encoded in form, not just a label.
- **Live now** — a rail of what's executing this second (agents + in-progress people) and the area each touches.
- **Collision detection** — two actors on the same project/paths in overlapping windows → warning before work is lost. The double-dispatch guard extends to human ownership: dispatching an agent onto a project a teammate is actively working prompts "someone's already here — proceed?"
- **The prize, pinned** — sprint/division goal at the top so the board is tickets *in service of one thing*.

## 4. Scope, in order (bounded, not a rewrite)
1. **Resource model** — dispatches + tasks share a shape: actor → project → touched paths → active window. Half-exists already.
2. **Human ingest** — Linear sync (issues/assignees/status) as first-class activity beside agent dispatches. Read-only first.
3. **Unified view** — board + live-now rendering both actor types from one activity feed.
4. **Collision engine** — overlap detection on (project, paths, window); generalize the dispatch guard to humans.
5. **Backend fork (only then)** — Postgres (SQLite is single-writer — hit its limits this week), identity model, authed webhook (`[42.D1]`). Gated on a real second operator.

Steps 1–4 are a feature layer prototypable against single-user Cascade with mocked teammates. Step 5 is the only architecture change and is gated on a real second user — never pay multi-tenant cost before the value is proven.

## 5. DeepFinLabs mapping
| 2.0 primitive | At DeepFinLabs |
|---|---|
| Projects as swimlanes | Departments as swimlanes |
| Agent + human on one board | A finance analyst and the finance agent, visible together |
| Collision on shared paths | An agent and a person touching the same ledger/policy → caught before conflict |
| The prize, pinned | The division's objective, above daily churn |

For a company handling money, "no two actors silently editing the same thing" is the governance surface, not a nicety.

## 6. Parallel moat (name now, build next)
**Cross-project knowledge graph** — lessons/outcomes linked across projects so the system can say "three projects hit this failure — here's what worked." Compounds monthly; no backend fork to prototype. Second spike after the board.
