# Session Handoff — Kilroy
Date: 2026-04-15

## Identity
This Claude instance is **Kilroy** — the engineer behind Delamain and Cascade. Named by Justin. Other project Claude instances are "terminal claude." Delamain is the Sonnet-based dispatcher inside Cascade's overseer chat.

## Current State
Cascade is PUBLIC at github.com/JustPinero/Cascade. 389+ tests across 63 files. CI green. All phases 1-9 complete. Preparing for Windows PC migration.

## What Was Built (summary across all sessions)

### Phases 1-6 (Original)
Scaffold, dashboard, knowledge base, project wizard, integrations, intervener.

### Phase 7 — Delamain Personality
Sound effects (Web Audio API synthesized tones), RPG portrait with talking animation (idle + open mouth swap).

### Phase 8 — Public Release
Customizable Overseer identity (name, portrait via localStorage), Engineer Channel (renamed from Kilroy, backwards compat), gitignored personal data, Windows/WSL2 platform detection, public release polish.

### Phase 9 — Dashboard Intelligence
Badges (deployed/client/testing/review/versioned), deploy health checks, CI status integration, blocked-on-human indicator, attention center (sidebar badge), deadlines with countdown, descriptive tooltips.

### Autonomy Upgrade (across sessions)
- Feedback loop: Stop hooks → webhook → targeted scan → escalation detection
- Session intelligence: session reader, Delamain context enrichment
- Learning: escalation detector, playbook learner, dispatch outcome tracking
- Notifications, morning briefing, conversation memory, semi-auto dispatch
- Voice input, CLI auth status, remaining work panel, human tasks page
- Retroactive harvest (147+ knowledge lessons from 17 projects)
- Agent team dispatch (lead Claude coordinates teammates via tmux)
- Kilroy ↔ Delamain channel (engineer-channel.md + API)

### Additional Work
- Hook format auto-repair (install-hooks.ts + /api/hooks/validate)
- Kickoff template v3.5 with prompt engineering audit fixes
- CI/CD setup prompt (standalone, in methodology repo)
- All GitHub repo descriptions updated across 19 projects
- READMEs written/updated for 8 projects
- Portfolio site updated: 3D particle field, tilt cards, React 19
- Templates scrubbed from git history, moved to private methodology repo
- Matinecock tribal site: asset conversion, seed updates, handoff prep

## Database
SQLite at ./dev.db (project root). 17 projects, 147+ knowledge lessons, dispatch outcomes, chat history, human tasks.

## Fleet Status
- 3 projects DONE: CON-CORE, pingthings, labwebsite
- 1 project BACKBURNER: PyrrhicVictory
- 2 projects EARLY: teamistry, sharpesanimalhouse (client)
- Rest: actively building at various progress levels

## Key Architectural Decisions
- Platform detection: detectPlatform() selects osascript (macOS) or tmux-direct (Linux/WSL2)
- Overseer is customizable: name/portrait in localStorage, defaults to "Overseer"
- Personal data never committed: playbook, lessons, sessions, channel, DB all gitignored
- Templates in private methodology repo (github.com/JustPinero/methodology)
- Agent team dispatch: lead Claude + teammates via CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

## Pending
- Windows native Cascade adaptation (run Next.js natively, dispatch via WSL2)
- Docker containerization (future)
- Phase 9 features need wiring into scan pipeline (deploy health, CI status)
- Matinecock site: Blob storage token, seed run on production

## People
- Dawn Lynch: mentor and guiding light. Asked Justin to finish site-unseen, medipal, ratracer.
- Mikey: cousin, 25yr coder, mentor. Bought Justin the PC.
- Christina: co-founder/partner for romereno (ReModel OS).
- Paula Sharpe: client for sharpesanimalhouse (pet platform).
- Robert Loomis: client for Zen.
- Deana: client for Canvas Caterers.
- Tec: client for matinecock-site. Non-technical, admin panel only.

[LESSON] Cascade's dev.db lives at project root, not prisma/. DATABASE_URL relative path resolves from project root.
[LESSON] Hook format bugs recur because terminal Claudes generate the old flat format. install-hooks.ts now auto-repairs.
[LESSON] WSL2 defaults to 50% of system RAM. On 16GB machines, this causes crashes. Set .wslconfig to cap memory.
