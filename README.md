# Cascade

A nerve center for orchestrating multi-project Claude Code workflows. Monitor project health, harvest knowledge across builds, and spin up new projects with AI-powered kickoff prompts.

## Stack

- **Frontend:** Next.js 14+ (App Router) with TypeScript strict
- **Styling:** Tailwind CSS (cyberpunk/DBZ aesthetic)
- **Database:** SQLite via Prisma 7
- **Testing:** Vitest (172 unit/integration) + Playwright (E2E)
- **Integrations:** Anthropic API, GitHub CLI, 1Password CLI

## Setup

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your ANTHROPIC_API_KEY

# Initialize database
pnpm exec prisma generate
pnpm exec prisma db push
pnpm db:seed

# Start dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and click "Scan Projects" to import your workspace.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server (Turbopack) |
| `pnpm build` | Production build |
| `pnpm test` | Run Vitest (unit + integration) |
| `pnpm test:e2e` | Run Playwright E2E tests |
| `pnpm lint` | Run ESLint |
| `pnpm validate` | Full validation (lint + typecheck + test + build) |
| `pnpm db:push` | Sync Prisma schema to SQLite |
| `pnpm db:seed` | Seed default kickoff template |
| `pnpm db:studio` | Open Prisma Studio |

## Features

- **Dashboard** -- Cyberpunk tile grid with health indicators, activity feed, filtering/search
- **Knowledge Base** -- Auto-harvests lessons from project audits, categorizes, searches
- **Project Wizard** -- 7-step wizard with embedded Claude conversation for kickoff generation
- **Reports** -- Per-project and cross-project reports (Markdown + PDF)
- **Integrations** -- 1Password env management, GitHub repo creation, Vercel/Railway deploy monitoring
- **Intervener** -- Auto-generates advisories when project issues match known lessons

## Architecture

Local-first app. SQLite indexes the filesystem (source of truth). Server components read fs directly. Only writes `.claude/nerve-center-advisory.md` to other projects -- everything else is read-only.

See `references/architecture.md` for full stack decisions.
