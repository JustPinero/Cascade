# Architecture Decisions

## Stack
| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | Next.js 14+ (App Router) | SSR for dashboard, server components for direct fs reads |
| Backend | Next.js API Routes | No separate backend needed; API routes handle fs scanning, shell execution |
| Language | TypeScript (strict mode) | Type safety across the full stack |
| Database | SQLite via Prisma | Lightweight, file-based, no server needed, perfect for local-first app |
| Styling | Tailwind CSS | Utility-first, works well with the cyberpunk aesthetic |
| Auth | None (v1) | Single-user local app; network-level auth (Tailscale) for remote access later |
| Hosting | localhost:3000 | Local dev server; deployable via Tailscale Funnel / Cloudflare Tunnel later |
| Testing | Vitest (unit/integration) + Playwright (E2E) | Fast unit tests + real browser E2E |
| Package Manager | pnpm | Fast, disk-efficient |

## Key Integrations
- **Anthropic API** — Powers Claude conversation in project creation wizard (server-side only)
- **GitHub CLI (gh)** — Repo creation, branch management during project setup
- **1Password CLI (op)** — Secret management, env var population
- **Vercel/Railway APIs** (Phase 5) — Deployment status monitoring

## Key Architectural Decisions
1. **File system is source of truth** — SQLite indexes and caches project data; the actual project directories are canonical
2. **Read-only project access** — Cascade only writes `.claude/nerve-center-advisory.md` to other projects; everything else is read-only
3. **Server components by default** — Only use "use client" when React state, effects, or event handlers are needed
4. **Incremental scanning** — Check file modification timestamps, only re-parse changed files for performance with 10+ projects
5. **Knowledge in-repo** — Knowledge base lives in /knowledge as git-tracked markdown files
6. **SQLite in .gitignore** — Database is derived from fs and can be rebuilt; not version-controlled
