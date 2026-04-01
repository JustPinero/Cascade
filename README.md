# Cascade

A nerve center for orchestrating multi-project Claude Code workflows. Monitor project health, harvest knowledge across builds, dispatch AI agents to your projects, and spin up new projects with kickoff prompts — all from one cyberpunk dashboard.

---

## Setup Guide (Start Here)

### Prerequisites

You need these installed on your machine before starting:

1. **Node.js 20+** — check with `node -v`
   - Install: https://nodejs.org or `brew install node`

2. **pnpm** — check with `pnpm -v`
   - Install: `npm install -g pnpm`

3. **Git** — check with `git -v`
   - Install: `brew install git` (Mac) or https://git-scm.com

4. **Anthropic API Key** — required for the Claude chat features
   - Get one at: https://console.anthropic.com/settings/keys
   - This costs money per use (the chat features call Claude's API)

5. **Claude Code CLI** (optional but recommended for dispatch)
   - Install: `npm install -g @anthropic-ai/claude-code`
   - This lets Cascade dispatch Claude to work on your projects autonomously

6. **GitHub CLI** (optional, for repo creation in the wizard)
   - Install: `brew install gh` then `gh auth login`

7. **1Password CLI** (optional, for secret management)
   - Install: https://1password.com/downloads/command-line/
   - Enable CLI integration in 1Password 8: Settings > Developer > "Integrate with 1Password CLI"

8. **tmux** (optional, for tiled terminal dispatch)
   - Install: `brew install tmux`

### Step-by-Step Installation

```bash
# 1. Clone the repo
git clone https://github.com/JustPinero/Cascade.git
cd Cascade

# 2. Install dependencies
pnpm install

# 3. Create your environment file
cp .env.example .env.local
```

Now open `.env.local` in a text editor and fill in your values:

```bash
# REQUIRED — get from https://console.anthropic.com/settings/keys
ANTHROPIC_API_KEY=sk-ant-your-key-here

# REQUIRED — path to the folder that contains your projects
# Change this to wherever YOUR projects live
PROJECTS_DIR=~/Desktop/projects

# These can stay as-is
CASCADE_KNOWLEDGE_DIR=./knowledge
DATABASE_URL="file:./dev.db"
```

**IMPORTANT:** `PROJECTS_DIR` must point to a folder where each subfolder is a project. Example:
```
~/Desktop/projects/
  ├── my-web-app/
  ├── my-api/
  ├── my-game/
  └── another-project/
```

Continue setup:

```bash
# 4. Initialize the database
pnpm exec prisma generate
pnpm exec prisma db push
pnpm db:seed

# 5. Start Cascade
bash scripts/start.sh
```

Open **http://localhost:3000** in your browser.

### First Use

1. Click **"Scan Projects"** on the dashboard — this imports all projects from your `PROJECTS_DIR`
2. You should see project tiles appear with health indicators
3. Click any project tile to see its detail page with the **Command Panel**
4. Try the **Overseer (Delamain)** chat at the top of the dashboard — tell it what you want done today

### Making Your Projects "Dispatch-Ready"

For Cascade to dispatch Claude Code to work on a project autonomously, the project needs:

- A `CLAUDE.md` file in the project root (tells Claude about the project)
- A `.git` directory (initialized git repo)
- A `package.json`, `Cargo.toml`, or `pyproject.toml` (project manifest)

Optional but helpful:
- `.claude/handoff.md` — Claude reads this to know where it left off
- `requests/` directory with phase subdirectories — tells Claude what to build next
- `audits/debt.md` — technical debt log

Projects WITHOUT these files will still appear on the dashboard but can't be dispatched. Cascade will tell you which projects aren't ready and why.

---

## Daily Usage

### The Dashboard

- **Scan Projects** — re-scans your workspace, updates health, harvests knowledge, generates advisories
- **Resume All** — dispatches Claude Code to every "building" project in a tmux grid
- **Delamain Chat** — tell the AI project manager what you want done today, it creates a dispatch plan

### Project Detail (click any tile)

- **Continue Build** — sends Claude to pick up where it left off
- **Run Audits** — full audit suite (tests, bugs, performance, drift)
- **Investigate Blocker** — diagnoses what's wrong
- **Custom Command** — type any instruction for Claude
- **Command Panel** — chat with Claude about the project (has full context)

### Other Pages

- **Roadmap** — bird's-eye table of all projects with phase progress bars
- **Playbook** — edit the rules that shape every dispatched Claude session
- **Knowledge Base** — lessons harvested from all projects, searchable by category
- **Templates** — manage kickoff templates for the project creation wizard
- **Reports** — generate per-project or cross-project reports (Markdown + PDF)
- **Settings** — switch between dark and light themes

---

## Scripts

| Command | Description |
|---------|-------------|
| `bash scripts/start.sh` | Start Cascade (generates Prisma, pushes schema, starts server) |
| `bash scripts/restart.sh` | Kill existing server and restart |
| `pnpm dev` | Start dev server directly (Turbopack) |
| `pnpm build` | Production build |
| `pnpm test` | Run 262 tests (Vitest) |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm lint` | Run ESLint |
| `pnpm validate` | Full validation (lint + typecheck + test + build) |
| `pnpm db:push` | Sync Prisma schema to SQLite |
| `pnpm db:seed` | Seed kickoff templates (6 templates) |
| `pnpm db:studio` | Open Prisma Studio (database viewer) |

---

## 1Password Integration (Optional)

If you use 1Password, Cascade can manage API keys across all your projects:

1. Make sure 1Password 8 desktop app is installed
2. Enable CLI integration: Settings > Developer > "Integrate with 1Password CLI"
3. Create a vault called "Cascade" in 1Password
4. Run: `bash scripts/populate-vault.sh` — scans all projects and stores their secrets
5. Use `bash scripts/populate-vault.sh --dry-run` to preview without changing anything

---

## Stack

- **Frontend:** Next.js 16 (App Router) with TypeScript strict
- **Styling:** Tailwind CSS 4 (cyberpunk/DBZ aesthetic with light theme option)
- **Database:** SQLite via Prisma 7 (local file, no server needed)
- **Testing:** Vitest (262 unit/integration) + Playwright (16 E2E)
- **AI:** Anthropic Claude API (streaming chat)
- **Dispatch:** tmux + Claude Code CLI

## Architecture

Local-first app. SQLite indexes the filesystem (source of truth). Server components read fs directly. Only writes `.claude/nerve-center-advisory.md` to other projects — everything else is read-only.

See `references/architecture.md` for full stack decisions.

---

## Troubleshooting

**"ANTHROPIC_API_KEY not configured"** — edit `.env.local` and set your key from console.anthropic.com

**"No projects found"** — check that `PROJECTS_DIR` in `.env.local` points to the right folder

**Terminal dispatch shows permission warning** — the `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=true` env var is set automatically; if you still see a prompt, type `2` (Yes) once

**1Password "operation not supported"** — upgrade to 1Password 8 and enable CLI integration

**Projects show as "not dispatch-ready"** — add a `CLAUDE.md` file to the project root

**Scan takes a long time** — normal for first scan; subsequent scans are faster (incremental)
