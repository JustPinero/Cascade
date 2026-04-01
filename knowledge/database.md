# Database Lessons

Category: database
Source: deployment-playbook (13 Prisma lessons) + project audits

## From Deployment Playbook
See `knowledge/deployment-playbook/guides/prisma-production.md` for full guide.

### Prisma Production Patterns
- [LESSON] Generate before compile: `prisma generate` must run before `tsc` in build pipeline
- [LESSON] Supabase connection strings: use IPv4 transaction pooler (port 6543) for app, DIRECT_URL for migrations
- [LESSON] First deploy: use `prisma db push` on empty DB, `migrate deploy` for subsequent deploys
- [LESSON] Docker: run Prisma from schema-owning package in pnpm monorepos
- [LESSON] Singleton pattern: use globalThis cache to prevent connection exhaustion in serverless
- [LESSON] Idempotent seeding: check for existing data before inserting

### SQLite-Specific (from Cascade)
- [LESSON] WAL mode: enable for concurrent reads
- [LESSON] JSON fields: store as String, parse manually (no native JSON type)
- [LESSON] File path: relative to schema location, not project root
