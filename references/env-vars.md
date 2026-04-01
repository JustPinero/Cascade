# Environment Variables

## Required
| Variable | Purpose | Where Used |
|----------|---------|------------|
| ANTHROPIC_API_KEY | Powers Claude conversation in project wizard | Server-side: /api/wizard/chat |
| DATABASE_URL | SQLite database connection | Prisma client |

## Optional (Phase 5)
| Variable | Purpose | Where Used |
|----------|---------|------------|
| VERCEL_TOKEN | Poll Vercel deployment status | /api/integrations/deploy-status |
| RAILWAY_TOKEN | Poll Railway deployment status | /api/integrations/deploy-status |

## Configuration (not secrets)
| Variable | Default | Purpose |
|----------|---------|---------|
| PROJECTS_DIR | ~/Desktop/projects | Root directory to scan for projects |
| CASCADE_KNOWLEDGE_DIR | ./knowledge | Path to knowledge directory |

## Notes
- ANTHROPIC_API_KEY must NEVER be exposed to client-side code
- DATABASE_URL points to a local SQLite file — no network access needed
- PROJECTS_DIR should be an absolute path or ~ prefixed
- All env vars are in .env.local (gitignored) with examples in .env.example
