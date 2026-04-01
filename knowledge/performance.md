# Performance Lessons

Category: performance
Source: deployment-playbook + project audits

## From Deployment Playbook

### Build Performance
- [LESSON] Turbo monorepo: use `--filter=app...` (with trailing dots) to include dependencies
- [LESSON] Docker single-stage builds faster than multi-stage for pnpm (avoids symlink issues)
- [LESSON] esbuild --packages=external for fast Docker builds (excludes node_modules)

### Runtime Performance
- [LESSON] WebSocket tick diffing: only send changed fields, reduces bandwidth 80-90%
- [LESSON] Prisma singleton pattern prevents connection pool exhaustion in serverless
- [LESSON] In-memory rate limiting resets on Railway restart — use Redis for persistence
- [LESSON] SuperHero API seed takes 2-3 minutes — add idempotent check to skip if data exists

### Caching
- [LESSON] Cache LLM responses in database for repeated queries
- [LESSON] React Query cache invalidation required after mutations (mobile Supabase)
- [LESSON] LLM response caching: hash prompt + model as cache key
