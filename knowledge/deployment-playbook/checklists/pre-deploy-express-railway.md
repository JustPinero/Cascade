# Pre-Deploy Checklist: Express + Railway

## railway.toml
- [ ] Builder configured (NIXPACKS or dockerfile)
- [ ] Health check path set (e.g., `/api/v1/health`)
- [ ] Health check timeout ≥ 120s (accounts for DB init on first deploy)
- [ ] Restart policy: `ON_FAILURE` with max 3-5 retries
- [ ] `--service` flag in deploy commands for multi-service projects

## Environment Variables
- [ ] `DATABASE_URL` set (Railway auto-provides with PostgreSQL addon)
- [ ] `JWT_SECRET` is a strong random value (not default)
- [ ] `NODE_ENV=production`
- [ ] `FRONTEND_URL` / `ADMIN_ORIGIN` set to exact frontend URLs (for CORS)
- [ ] Zod validation at startup with `process.exit(1)` on failure

## Express Configuration
- [ ] `app.set('trust proxy', 1)` — required for rate limiting behind Railway's proxy
- [ ] CORS origins match frontend URL exactly (no trailing slash, correct protocol)
- [ ] Socket.io CORS matches Express CORS (if using WebSockets)
- [ ] Rate limiting configured (global + per-user/per-IP)
- [ ] Body parser has size limit: `express.json({ limit: '1mb' })`

## Health Check
- [ ] Returns 200 even during DB initialization (use `dbConnected` field)
- [ ] No auth required on health endpoint
- [ ] Includes DB connectivity check (`SELECT 1`)

## Graceful Shutdown
- [ ] SIGTERM handler closes: HTTP server → WebSockets → job queues → DB
- [ ] Force-exit timeout (10s) prevents hanging shutdown
- [ ] `unhandledRejection` and `uncaughtException` handlers with logging

## Database
- [ ] Prisma generate runs before TypeScript compilation
- [ ] First deploy: use `prisma db push` (not `migrate deploy`)
- [ ] Seed script is idempotent (checks for existing data)
- [ ] Connection pooling configured if using Supabase

## Build (NIXPACKS monorepo)
- [ ] Install commands chain `cd` for each workspace
- [ ] Build order: client → prisma generate → server build
- [ ] Start command: `prisma migrate deploy && npm start`

## Build (Docker)
- [ ] Single-stage build (preserves pnpm symlinks)
- [ ] `.npmrc` copied into build
- [ ] CLI tools installed globally (`npm install -g prisma esbuild tsx`)
- [ ] `--frozen-lockfile` on install
- [ ] `@prisma/client` is direct dependency of API package

## Post-Deploy
- [ ] `curl /api/v1/health` returns 200 with `dbConnected: true`
- [ ] Test one authenticated endpoint
- [ ] Test error handling: POST with empty body returns 400 (not 500)
- [ ] Check Railway logs for startup messages
- [ ] If Socket.io: test WebSocket connection from browser
