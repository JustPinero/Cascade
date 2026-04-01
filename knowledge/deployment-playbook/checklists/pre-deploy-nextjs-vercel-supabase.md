# Pre-Deploy Checklist: Next.js + Vercel + Supabase

## Environment Variables

- [ ] All env vars set on Vercel using `printf` (NOT `echo`) to avoid trailing newlines
- [ ] Env vars set for ALL three Vercel environments: Production, Preview, Development
- [ ] `DATABASE_URL` uses Supabase **IPv4 Transaction Pooler** (`aws-1-` prefix, port `6543`, `?pgbouncer=true`)
- [ ] `DIRECT_URL` set for migrations (bypasses PgBouncer — port `5432`, no `?pgbouncer=true`)
- [ ] `NEXTAUTH_URL` set to production URL (e.g., `https://yourapp.vercel.app`)
- [ ] `NEXTAUTH_SECRET` is a random 32+ character string (generate with `openssl rand -base64 32`)
- [ ] OAuth client IDs/secrets match the provider dashboard exactly (no whitespace, no newlines)
- [ ] OAuth redirect URIs on provider dashboards point to production URL (not localhost)
- [ ] Stripe webhook secret matches the webhook endpoint configured in Stripe dashboard
- [ ] No secrets in `NEXT_PUBLIC_*` variables (they're inlined into client JS)
- [ ] `.env.example` committed with all required variable names (no values)
- [ ] Zod validation at server startup — app exits immediately if required vars are missing
- [ ] Run `scripts/validate-env.sh` before deploying

## Database

- [ ] Prisma migrations applied to production: `npx prisma migrate deploy`
- [ ] `prisma generate` runs in build: `"build": "prisma generate && next build"` in package.json
- [ ] `"postinstall": "prisma generate"` in package.json (covers cached node_modules)
- [ ] Connection string uses pooler (port 6543), not direct (port 5432)
- [ ] If first deploy on fresh DB: use `prisma db push` (not `migrate deploy`)
- [ ] Seed scripts are idempotent (check for existing data before inserting)
- [ ] Prisma client uses singleton pattern (prevents connection pool exhaustion during HMR)
- [ ] Test connection: `npx prisma db execute --stdin <<< "SELECT 1"`

## Auth

- [ ] If using database sessions: custom middleware (NOT `export { default } from "next-auth/middleware"`)
- [ ] Middleware checks BOTH cookie names: `__Secure-next-auth.session-token` (HTTPS) and `next-auth.session-token` (HTTP)
- [ ] Google OAuth: Authorized redirect URI is `https://yourapp.vercel.app/api/auth/callback/google`
- [ ] GitHub OAuth: Callback URL is `https://yourapp.vercel.app/api/profile/github/callback`
- [ ] No seed-created users without corresponding Account records (causes OAuthAccountNotLinked)
- [ ] Don't use Proxy for NextAuth config — use a simple lazy singleton instead

## Build

- [ ] Every API route has `export const dynamic = "force-dynamic"` at the top
- [ ] If Tailwind v4: `@config` directive in CSS entry point pointing to config file
- [ ] If monorepo: `vercel.json` at repo root with `turbo --filter=@app/web...` (with `...` suffix)
- [ ] `pnpm build` succeeds locally before pushing
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] No `console.log` in production code

## Server (if Express API on Railway)

- [ ] `app.set('trust proxy', 1)` — required behind Railway's reverse proxy
- [ ] CORS origins match frontend URL exactly (no trailing slash)
- [ ] Socket.io CORS matches Express CORS (if using WebSockets)
- [ ] Health check returns 200 even during DB initialization
- [ ] Graceful shutdown: SIGTERM handler closes server → sockets → queues → DB
- [ ] Health check timeout ≥ 120s in railway.toml for first deploy

## Assets

- [ ] Favicon in `public/` as real PNG (not a renamed .ico)
- [ ] OG image in `public/` with metadata in layout.tsx
- [ ] All images referenced in code exist in `public/`

## Security

- [ ] `.env` and `.env.local` in `.gitignore`
- [ ] `.gitignore` uses specific patterns (`.env.local`) not broad ones (`.env*`)
- [ ] No API keys, secrets, or tokens in committed code
- [ ] No hardcoded user data in source (check migration files are acceptable)
- [ ] `git log --all -p | grep -iE 'sk-|sk_live|ghp_|AIza|AKIA'` returns nothing
- [ ] Security headers configured: CSP, X-Frame-Options, X-Content-Type-Options
- [ ] CSP includes auth provider domains if using Clerk/Auth0

## Post-Deploy

- [ ] Hit `/api/health` (or equivalent) — verify `dbConnected: true`
- [ ] Test sign-in flow end to end
- [ ] Test in incognito to verify no cached state issues
- [ ] Check favicon loads (incognito)
- [ ] Check OG image by sharing link in Slack/iMessage
- [ ] Navigate directly to a nested route (test SPA routing)
- [ ] If Socket.io: test WebSocket connection from browser console
- [ ] CI has post-deploy smoke tests (health + one functional endpoint)
