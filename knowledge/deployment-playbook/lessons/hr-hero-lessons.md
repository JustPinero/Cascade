# HR Hero — Deployment Lessons

## Stack
React 18 + Vite (Frontend), Express 5 + Prisma 6 + PostgreSQL (Backend), Claude Haiku AI, Railway (NIXPACKS), monorepo (client/ + server/)

---

## 1. CLIENT_URL CORS default blocks production when serving from same origin

### Symptom
API calls returned CORS errors in production even though the frontend and backend were on the same Railway domain.

### Root Cause
`CLIENT_URL` env var defaulted to `http://localhost:5173` (Vite dev server). In production, the Express server serves the built client from the same origin, so CORS origin needed to be `'*'` or the actual Railway domain.

### Fix
Changed the default in env validation:
```typescript
const envSchema = z.object({
  CLIENT_URL: z.string().default('*'),  // Was: 'http://localhost:5173'
});
```

### Prevention
- **If backend serves the frontend in production (same origin), set CORS to `'*'` or omit CORS entirely**
- The Vite dev proxy makes CORS invisible in development — always test production CORS separately
- Document which mode (separate origins vs same origin) your deployment uses

### Time to Diagnose
~10 minutes

---

## 2. NIXPACKS monorepo build requires explicit `cd` between directories

### Symptom
Railway build failed — NIXPACKS ran `npm ci` only in the root directory, missing client and server dependencies.

### Root Cause
NIXPACKS doesn't understand npm workspaces by default. It installs from the root `package.json` only. Client and server have separate `package.json` files that need their own install + build steps.

### Fix
Explicit `cd` commands in `railway.toml`:
```toml
[build.nixpacks]
installCmd = "cd client && npm ci && cd ../server && npm ci"
buildCmd = "cd client && npm run build && cd ../server && npx prisma generate && npm run build"

[deploy]
startCommand = "cd server && npx prisma migrate deploy && npm start"
```

### Prevention
- **For NIXPACKS monorepo builds, always chain `cd` commands for each workspace**
- Order matters: client builds first (server may serve client's `dist/`), then Prisma generate, then server build
- Consider Docker-based builds for more control

### Time to Diagnose
~15 minutes

---

## 3. `prisma generate` must run before TypeScript compilation

### Symptom
`npm run build` in the server directory failed with TypeScript errors — `@prisma/client` types not found.

### Root Cause
Prisma generates its TypeScript types during `prisma generate`. If this doesn't run before `tsc`, all Prisma imports fail type checking. The build command had the wrong order.

### Fix
Correct build order in `railway.toml`:
```
buildCmd = "... && cd ../server && npx prisma generate && npm run build"
```

### Prevention
- **Always run `prisma generate` before any TypeScript compilation step**
- Add `"postinstall": "prisma generate"` to `server/package.json` as a safety net
- This is the same issue as RatRacer lesson #3 — it applies everywhere Prisma is used

### Time to Diagnose
~5 minutes

---

## 4. Seed script on first deploy is slow — SuperHero API fetch takes 2-3 minutes

### Symptom
First Railway deployment appeared stuck for several minutes after migrations ran. Logs showed sequential API calls to superheroapi.com.

### Root Cause
The seed script fetches all 731 superheroes one-by-one from the SuperHero API with 200ms delays between requests (to avoid rate limiting). This takes ~2-3 minutes on first deploy.

### Fix
Added idempotent check to skip re-fetching:
```typescript
const existingCount = await prisma.hero.count();
if (existingCount >= 700) {
  console.log('Heroes already seeded, skipping fetch.');
  return;
}
```

### Prevention
- **Seed scripts must be idempotent** — check if data exists before fetching
- For large seeds, consider shipping a SQL dump instead of runtime API calls
- Add logging so slow seeds don't look like hangs
- If the external API is down, seeding fails and blocks deployment

### Time to Diagnose
~5 minutes (once identified as seeding, not a crash)

---

## 5. In-memory rate limiting resets on Railway restart

### Symptom
After Railway restarts (deploys, crashes, scaling), the AI daily usage counter resets to 0, allowing more calls than the intended 200/day limit.

### Root Cause
The global AI call counter is stored in process memory:
```typescript
let aiCallCount = 0;
setInterval(() => { aiCallCount = 0; }, RESET_INTERVAL_MS);
```
Railway restarts the process on every deploy, resetting the counter.

### Fix
Acknowledged as acceptable for a single-instance side project. For production:
- Move counter to Redis or a database table
- Use Railway's Redis addon

### Prevention
- **In-memory counters reset on restart** — use persistent storage for counters that matter
- For multi-instance deployments, in-memory counters are per-instance (3 instances = 3x the limit)
- Redis-backed rate limiting (e.g., `rate-limit-redis`) is the standard solution

### Time to Diagnose
~N/A (design decision, not a bug)

---

## 6. Health check doesn't verify database connectivity

### Symptom
Railway reported the service as healthy, but database queries were failing with connection errors.

### Root Cause
Health check only confirmed the Express server was running:
```typescript
router.get('/api/health', (_req, res) => {
  res.json({ status: 'operational' });
});
```
No database query was executed, so a dead DB connection went undetected.

### Fix
Not yet implemented. Recommended:
```typescript
router.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'operational', database: 'healthy' });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'unreachable' });
  }
});
```

### Prevention
- **Health checks should verify all critical dependencies** (database, Redis, external APIs)
- But: return 200 with degraded status (not 503) if you don't want Railway to kill the container during transient DB issues (see medipal lesson #4)

### Time to Diagnose
~N/A (discovered during review)

---

## 7. No graceful shutdown handler

### Symptom
During Railway redeployments, in-flight API requests (especially AI generation calls that take 2-5 seconds) were dropped.

### Root Cause
No `SIGTERM` handler. Railway sends SIGTERM before killing the old container, but without a handler, Node.js exits immediately.

### Fix
Not yet implemented. Recommended:
```typescript
process.on('SIGTERM', () => {
  server.close(() => {
    prisma.$disconnect();
    process.exit(0);
  });
});
```

### Prevention
- **Every production server needs SIGTERM/SIGINT handlers** — especially for long-running requests like AI calls
- This is the same pattern as medipal lesson #8

### Time to Diagnose
~N/A (discovered during review)

---

## 8. Claude AI JSON parse failures need retry logic

### Symptom
Occasionally the hero-to-position matching endpoint returned a 503 error. Logs showed `SyntaxError: Unexpected token` during JSON parse of Claude's response.

### Root Cause
Claude sometimes wraps JSON responses in markdown code fences (`` ```json ... ``` ``) even when instructed to return raw JSON. The `JSON.parse()` call fails on the markdown wrapper.

### Fix
Added retry logic with a second attempt:
```typescript
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    const parsed = JSON.parse(block.text);
    return parsed.matches;
  } catch (err) {
    if (attempt === 0) continue;  // Retry once
    throw new ServiceUnavailableError('AI response parse failed');
  }
}
```

### Prevention
- **Always expect LLM responses to be imperfectly formatted** — strip code fences, handle markdown wrapping
- Implement a `stripCodeFences()` utility for any JSON-from-LLM parsing
- Cache successful AI results to avoid redundant API calls (HR Hero does this via `HeroPositionMatch` table)

### Time to Diagnose
~10 minutes

---

## 9. Vite dev proxy masks CORS issues until production

### Symptom
Everything worked perfectly in local development. CORS errors only appeared after deploying to Railway.

### Root Cause
Vite's dev server proxies `/api` requests to `http://localhost:3001`, making them same-origin from the browser's perspective. CORS headers are never needed. In production, the client is served from the same Express server, so CORS shouldn't be needed either — but the middleware was still applying `origin: 'http://localhost:5173'` which blocked same-origin requests.

### Fix
Set `CLIENT_URL='*'` in production (see lesson #1).

### Prevention
- **Vite's dev proxy hides CORS issues** — always test with `npm run build && npm run preview` locally to catch them
- Or: run client and server on different ports locally without the proxy to surface CORS early

### Time to Diagnose
~10 minutes (combined with lesson #1)

---

# Summary

**Total issues found:** 9

**Top 3 most time-consuming to diagnose:**
1. **NIXPACKS monorepo build ordering** (~15 min) — getting install/build/start commands right across client + server
2. **CORS default blocking production** (~10 min) — dev proxy masked the issue
3. **Claude JSON parse failures** (~10 min) — intermittent, needed to reproduce

**Patterns identified:**
- **3 build/deploy pipeline issues** (#2, #3, #4) — NIXPACKS monorepo builds need explicit orchestration; Prisma generate ordering is critical
- **2 CORS issues** (#1, #9) — Vite dev proxy consistently hides CORS problems until production
- **2 missing production hardening items** (#6, #7) — health checks and graceful shutdown are common gaps
- **1 AI integration issue** (#8) — LLM responses need defensive parsing; this is a recurring pattern
