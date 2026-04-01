# Environment Variables — The #1 Deployment Pain Point

> 19 of 103 lessons across 11 projects were env var issues.
> This guide consolidates every pattern into one reference.

---

## The Rules

### 1. Framework prefixes control visibility

| Framework | Client-side prefix | Server-only |
|-----------|-------------------|-------------|
| Next.js | `NEXT_PUBLIC_` | Everything else |
| Vite | `VITE_` | Everything else |
| Expo | `EXPO_PUBLIC_` | Everything else |
| Create React App | `REACT_APP_` | Everything else |

**What happens without the prefix:** The variable is `undefined` in the browser. No error, no warning — just `undefined`. Your app silently breaks.

**What happens WITH the prefix:** The value is **inlined into the JavaScript bundle at build time**. Anyone can read it from DevTools or the built JS file.

**The implication:** Never put secrets (API keys, database URLs, auth secrets) behind a public prefix. They get baked into client code.

### 2. Build-time vs runtime

`NEXT_PUBLIC_*`, `VITE_*`, and `EXPO_PUBLIC_*` are all **build-time** variables. They're replaced with literal strings during compilation. This means:

- Changing them requires a rebuild/redeploy
- They can't be overridden at runtime
- Setting them via shell `export` doesn't always work (see PointPartner lesson #1)

**For Next.js:** Create a committed `.env` with placeholder values. Real values go in `.env.local` (gitignored) or your hosting platform's env var settings.

### 3. Validate at startup, not at usage

Don't wait for code to crash when it tries to use a missing env var. Validate everything at server startup:

```typescript
// packages/api/src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Format-sensitive vars get regex validation
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'Must be 64 hex chars'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten());
  process.exit(1);
}
export const env = parsed.data;
```

For frontend apps, add a runtime check at app initialization:
```typescript
const API_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!API_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env.');
}
```

### 4. Platform-specific gotchas

**Vercel:**
- Use `printf` (not `echo`) when piping env vars via CLI — `echo` appends `\n` (RatRacer #1)
- Set vars for all three environments: Production, Preview, Development (DocDoc #5)
- `vercel link` overwrites `.env.local` with project env vars (PointPartner #8)

**Railway:**
- Injects `PORT` at runtime — always read from env, never hardcode
- `DATABASE_URL` auto-provided when PostgreSQL addon is attached
- Account tokens ≠ project tokens for CLI (PointPartner #9)

**Expo/EAS:**
- `EXPO_PUBLIC_*` gets compiled into the app binary — visible to anyone with the APK/IPA
- Use `eas secret:create` for production values
- Different client IDs needed per platform (iOS vs Web vs Android) — use `Platform.OS` branching

### 5. The `.env.example` contract

Every project must have a committed `.env.example` with:
- Every required variable name
- Placeholder values (not real ones)
- Comments explaining what each var is for
- No actual secrets

This is the source of truth for onboarding. If a variable exists in code but not in `.env.example`, it's a bug (GYLR2 #4).

### 6. CORS origins are env vars too

`ADMIN_ORIGIN`, `FRONTEND_URL`, `CLIENT_URL` — these control CORS. Mismatches cause:
- HTTP CORS: visible browser errors
- Socket.io CORS: **silent connection failure** (Site-Unseen #4)

Always set these explicitly. Never default to `*` in production unless frontend and backend are truly same-origin (HR Hero #1).

---

## Checklist

- [ ] All secrets are server-side only (no `VITE_`, `NEXT_PUBLIC_`, `EXPO_PUBLIC_` prefix)
- [ ] `.env.example` committed with every required variable
- [ ] `.env`, `.env.local`, `.env.production` in `.gitignore`
- [ ] Zod validation at server startup — `process.exit(1)` on failure
- [ ] Frontend runtime check for required public vars with helpful error message
- [ ] CORS origins set via env vars, matching frontend URL exactly
- [ ] Platform env vars set for all environments (Vercel: Prod + Preview + Dev)
- [ ] No `echo` for piping env vars to Vercel CLI — use `printf`

---

## Projects where this broke

| Lesson | Project | What happened |
|--------|---------|---------------|
| RatRacer #1 | `echo` added `\n` to OAuth client ID | Google OAuth rejected it |
| PointPartner #1 | Shell `export` didn't propagate to Next.js build | Build failed |
| PointPartner #8 | `vercel link` overwrote `.env.local` | Lost Supabase credentials |
| DocDoc #2 | Missing `VITE_` prefix | Clerk key was `undefined` in browser |
| DocDoc #5 | Vercel Preview env not set | Preview deploys showed blank page |
| MonsterMash #1 | API keys in `VITE_*` vars | Keys visible in browser DevTools |
| GYLR2 #4 | `.env.example` missing a variable | New dev setup failed |
| HR Hero #1 | CORS default was `localhost:5173` | Production API calls blocked |
| Medipal #12 | No env validation at startup | Runtime crashes on missing vars |
