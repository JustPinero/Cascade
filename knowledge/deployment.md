# Deployment Lessons

Category: deployment
Source: 103 lessons across 11 projects (deployment-playbook)

## Playbook Reference
See `knowledge/deployment-playbook/` for the full deployment knowledge base:
- `DEPLOYMENT-PLAYBOOK.md` — Master compilation: top 15 mistakes, symptom→fix tables, code templates
- `checklists/` — Pre-deploy checklists for Next.js+Vercel, Express+Railway, Expo+EAS, Vite+Vercel
- `guides/` — Deep-dive guides for environment variables, Prisma, Docker, WebSockets, LLM APIs, Railway, Vercel
- `lessons/` — Per-project lessons from RatRacer, PointPartner, MediPal, ARC, E1C, GYLR2, HR Hero, DocDoc, MonsterMash, Site-Unseen, Portfolio
- `references/platform-docs.md` — Where to find info on Vercel, Railway, Supabase, Expo, Prisma, Express, Socket.io

## Key Patterns (Quick Reference)

### Environment Variables (#1 pain point — 19 of 103 lessons)
- Framework prefixes: NEXT_PUBLIC_, VITE_, EXPO_PUBLIC_ — never put secrets in these
- Vercel: use `printf` not `echo` for env vars (trailing newlines break OAuth)
- Validate at startup with Zod schema
- Set for ALL environments (Production, Preview, Development)

### Prisma in Production (13 lessons)
- `prisma generate` must run before TypeScript compilation
- Supabase: use IPv4 transaction pooler (port 6543), DIRECT_URL for migrations
- First deploy: use `db push` not `migrate deploy` on empty database
- Docker: run Prisma from schema-owning package, single-stage builds for pnpm

### Docker + pnpm Monorepo (12 lessons)
- pnpm symlinks break in multi-stage Docker — use single-stage builds
- Copy .npmrc before install, install CLI tools globally
- Conditional seeding prevents data overwrites

### WebSocket/Socket.io (7 lessons)
- CORS must match between Express and Socket.io (silent failure without it)
- JWT tokens expire during long WS sessions — add refresh listeners
- Race conditions on concurrent events — use Set-based mutex
- Tick diffing reduces bandwidth 80-90%

<!-- Harvester: index all .md files in knowledge/deployment-playbook/lessons/ -->
