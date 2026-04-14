# Cascade

A nerve center for orchestrating multi-project Claude Code workflows. The Overseer — your customizable AI fleet dispatcher — manages your projects, learns from every session, and tells you when it needs you.

---

## What It Does

- **Fleet Dashboard** — monitor health, progress, and status across all your projects at a glance
- **the Overseer AI Dispatcher** — tell the Overseer what you want done today and he creates dispatch plans, launches Claude sessions, and tracks outcomes
- **Closed Feedback Loop** — sessions report back automatically via Stop hooks (Claude Code events that fire when a session ends). Cascade knows when sessions end, what happened, and what went wrong
- **Knowledge Base** — 100+ lessons harvested from project history. the Overseer uses these to advise other projects
- **Morning Briefing** — auto-generated summary of what happened overnight, what's blocked, and what to prioritize
- **Conversation Memory** — the Overseer remembers yesterday's sprint plan and references it today
- **Semi-Auto Dispatch** — routine "continue" operations execute automatically without approval
- **Human Tasks** — things only you can do (upload assets, get API keys) tracked in a checklist. Claude sessions auto-create them with `[HUMAN TODO]` tags
- **Voice Input** — talk to the Overseer with your voice via browser SpeechRecognition
- **Desktop Notifications** — get notified when sessions end or blockers are detected
- **Retroactive Harvest** — extract lessons from project git history, even projects started before Cascade existed
- **Dispatch Outcome Tracking** — the Overseer learns which recommendations actually work

---

## Setup Guide

### Prerequisites

**All platforms:**
1. **Node.js 20+**
2. **pnpm** — `npm install -g pnpm`
3. **Git**
4. **Anthropic API Key** — get from [console.anthropic.com](https://console.anthropic.com/settings/keys)
5. **Claude Code CLI** (recommended) — `npm install -g @anthropic-ai/claude-code`
6. **tmux** (recommended for multi-project dispatch)

**macOS:**
```bash
brew install node pnpm git tmux
```

**Windows (via WSL2):**
```bash
# 1. Install WSL2 (run in PowerShell as Admin)
wsl --install

# 2. Open Ubuntu from Start Menu, then inside WSL2:
sudo apt update && sudo apt install -y git tmux curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc && nvm install 20
npm install -g pnpm @anthropic-ai/claude-code

# 3. Access Cascade at http://localhost:3000 from your Windows browser
```

**Linux:**
```bash
sudo apt install -y git tmux curl  # Ubuntu/Debian
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc && nvm install 20
npm install -g pnpm @anthropic-ai/claude-code
```

### Installation

```bash
git clone https://github.com/JustPinero/Cascade.git
cd Cascade
pnpm install

# Create environment file
cp .env.example .env.local
# Edit .env.local — set ANTHROPIC_API_KEY and PROJECTS_DIR

# Initialize database
pnpm exec prisma generate
pnpm exec prisma db push
pnpm db:seed

# Start Cascade
bash scripts/start.sh
```

Open **http://localhost:3000**.

### First Use

1. Click **Scan Projects** to import your projects
2. Click **the Overseer** in the sidebar to talk to the AI dispatcher
3. Tell the Overseer what you want done — he'll create a dispatch plan

### Making Projects Dispatch-Ready

Projects need: `CLAUDE.md` + `.git` + `package.json` (or equivalent). Optional: `.claude/handoff.md`, `requests/` directory, `audits/debt.md`.

### Installing Session Hooks

Run once to install Stop hooks on all projects (enables the feedback loop):

```bash
npx tsx scripts/install-hooks.ts        # install
npx tsx scripts/install-hooks.ts --dry-run  # preview first
```

---

## Pages

| Page | Purpose |
|------|---------|
| **Dashboard** | Project tiles with health, progress, activity feed, morning briefing |
| **the Overseer** | Full-screen AI chat — sprint planning, dispatch, fleet management |
| **My Tasks** | Human-only tasks checklist (assets, credentials, manual testing) |
| **Roadmap** | Bird's-eye table of all projects with progress bars |
| **Playbook** | Rules that shape every dispatched Claude session |
| **Knowledge Base** | Lessons harvested from all projects, searchable |
| **Templates** | Kickoff templates for the project creation wizard |
| **Reports** | Per-project and cross-project reports (Markdown + PDF) |
| **Settings** | Theme, notifications, sounds, auto-dispatch, CLI auth status |

---

## Key Concepts

**The Overseer** — Claude Sonnet instance running inside Cascade. Your AI fleet dispatcher (customizable name and portrait via Settings). Plans sprints, recommends dispatches, tracks outcomes. Has conversation memory and learns from results.

**Engineer Channel** — Optional feature for power users. If you have a dedicated Claude Code instance for building and maintaining Cascade itself, you can set up a shared communication channel between it and the Overseer.

**Stop Hooks** — Claude Code hooks installed on every project. When a session ends, the hook copies the handoff to a session log and pings Cascade's webhook. Cascade auto-scans that project and fires desktop notifications.

**Backburner** — Project status for intentionally parked projects. Suppressed from sprint planning and health warnings.

---

## Scripts

| Command | Description |
|---------|-------------|
| `bash scripts/start.sh` | Start Cascade |
| `bash scripts/restart.sh` | Kill and restart |
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm test` | Run 360+ tests (Vitest) |
| `pnpm lint` | ESLint |
| `scripts/validate.sh` | Full CI validation (lint + types + test + build) |
| `npx tsx scripts/install-hooks.ts` | Install Stop hooks on all projects |

---

## Stack

- **Frontend:** Next.js 16 (App Router), TypeScript strict, Tailwind CSS 4
- **Database:** SQLite via Prisma 7 (local file)
- **AI:** Anthropic Claude API (Sonnet for chat, Haiku for briefing/harvest)
- **Testing:** Vitest (360+ tests) + Playwright E2E
- **Dispatch:** tmux + Claude Code CLI
- **Audio:** Web Audio API (synthesized tones)

---

## Troubleshooting

**"ANTHROPIC_API_KEY not configured"** — edit `.env.local` with your key from console.anthropic.com

**"credit balance too low"** — add credits at console.anthropic.com → Plans & Billing. Cascade uses ~$3-5/month.

**No projects found** — check `PROJECTS_DIR` in `.env.local` points to your projects folder

**Projects show "not dispatch-ready"** — add a `CLAUDE.md` file to the project root

**Database empty after restart** — the SQLite file is at `./dev.db` (project root, not `prisma/`)
