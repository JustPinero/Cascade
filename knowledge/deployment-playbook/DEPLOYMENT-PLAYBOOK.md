# Justin's Deployment Playbook
### 103 lessons from 11 real projects — compiled reference

---

# Part 1: The Top 15 Mistakes (80% of all deployment pain)

These 15 patterns account for the vast majority of deployment failures across all projects. Fix these and most deploys go smooth.

## 1. Missing or wrong environment variables
**Hit in:** Every single project
- Client-side prefix (`VITE_`, `NEXT_PUBLIC_`, `EXPO_PUBLIC_`) bakes values into JS at build time
- Never put secrets behind a client prefix — anyone can read them
- Validate all env vars at startup with Zod — `process.exit(1)` on failure
- Keep `.env.example` committed and in sync

## 2. No SPA rewrite rule on Vercel
**Hit in:** DocDoc, MonsterMash, Site-Unseen
- Direct URL to `/tools/roster` returns 404 without it
- Fix: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`

## 3. Prisma generate not in build pipeline
**Hit in:** RatRacer, medipal, HR Hero, ARC
- `prisma generate` must run BEFORE `tsc` or `next build`
- Add to both `build` and `postinstall` scripts
- In Docker: `pnpm --filter @app/db exec prisma generate`

## 4. CORS origin mismatch
**Hit in:** medipal, Site-Unseen, HR Hero, ARC
- Express CORS and Socket.io CORS must use identical origins
- Socket.io CORS mismatch = **silent failure** (no browser error)
- No trailing slash, correct protocol (https not http)

## 5. No graceful shutdown handler
**Hit in:** medipal, HR Hero, Site-Unseen
- Railway sends SIGTERM before killing containers
- Without a handler: dropped requests, lost WebSocket connections
- Pattern: close server → close sockets → drain queues → disconnect DB

## 6. Health check blocks deployment
**Hit in:** medipal, ARC
- Returning 503 during DB init makes Railway kill the container
- Fix: always return 200, use `dbConnected` field for actual status
- Set healthcheck timeout to 120s+ for first deploy

## 7. `trust proxy` not set behind reverse proxy
**Hit in:** Site-Unseen
- Without it, `req.ip` returns the proxy IP, not the client
- All rate limiting breaks (everyone shares one bucket)
- Fix: `app.set('trust proxy', 1)`

## 8. pnpm symlinks break in multi-stage Docker
**Hit in:** medipal, ARC
- `COPY --from=builder` dereferences pnpm's virtual store symlinks
- Fix: single-stage build, or use `pnpm deploy`

## 9. API keys exposed in client bundle
**Hit in:** MonsterMash, GYLR2
- `VITE_API_KEY` and `EXPO_PUBLIC_API_KEY` are visible to anyone
- Fix: server-side proxy (Vercel Serverless Functions or Express)

## 10. LLM responses wrapped in markdown code fences
**Hit in:** HR Hero, MonsterMash, GYLR2
- Claude sometimes returns `` ```json {...} ``` `` even when asked for raw JSON
- Fix: strip code fences before `JSON.parse`, add retry logic

## 11. WebSocket JWT expiry kills connection silently
**Hit in:** medipal, Site-Unseen
- Socket.io client grabs token once on mount — dies after token lifetime
- Fix: subscribe to token refresh events, reconnect with new token

## 12. Monorepo build ordering wrong
**Hit in:** PointPartner, HR Hero, ARC, medipal
- Each platform handles workspaces differently
- Vercel: `cd ../.. && pnpm turbo build --filter=@app/web...`
- Railway NIXPACKS: chain `cd` commands
- Docker: explicit workspace copying

## 13. App Store rejection for incomplete features
**Hit in:** E1C
- Apple reviewers test every visible button
- Non-functional OAuth button = instant rejection
- iPad blank screen = rejection (support it or disable it)

## 14. Supabase RLS infinite recursion
**Hit in:** E1C
- Cross-table RLS policies can create circular dependencies
- Queries hang forever with no error
- Fix: `SECURITY DEFINER` functions break the cycle

## 15. In-memory state lost on restart
**Hit in:** HR Hero (rate limit counter), Site-Unseen (active simulations)
- Counters, active sessions, in-progress work reset on deploy
- Fix: use Redis or DB for state that must survive restarts
- For zombie processes: recovery script at startup

---

# Part 2: Symptom → Fix Quick Reference

When you see this error, go to this lesson.

## Build Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Cannot find module '@prisma/client'` | Prisma generate didn't run | Add to `build` and `postinstall` scripts |
| `PrismaClientInitializationError` | Wrong connection string or cached client | Use IPv4 pooler (aws-1-, port 6543), run `prisma generate` |
| `Cannot apply unknown utility class` | Tailwind v4 missing `@config` directive | Add `@config "../../tailwind.config.ts"` to globals.css |
| `Failed to collect page data for /api/...` | Next.js static analysis on dynamic routes | Add `export const dynamic = "force-dynamic"` |
| `Call retries were exceeded` | Next.js 16 Turbopack + webpack plugin | Add `--webpack` flag to build command |
| `Object literal may only specify known properties, and 'test'` | Vitest config without reference directive | Add `/// <reference types="vitest" />` to vite.config.ts |
| `unmet peer vite@"^6.0.0"` | Vitest v4 installed for Vite 5 project | Pin `vitest@^2` for Vite 5 |
| `MODULE_NOT_FOUND` in Docker | Multi-stage build broke pnpm symlinks | Use single-stage Docker build |
| `esbuild: command not found` in Docker | CLI tool not globally installed | `RUN npm install -g esbuild` |

## Runtime / Production Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `invalid_client` on OAuth | Trailing newline in env var | Use `printf` not `echo` for Vercel env vars |
| `OAuthAccountNotLinked` | Seed-created user without Account record | Delete unlinked user, let OAuth create fresh |
| CORS error in production, works locally | Vite dev proxy masks CORS; wrong CLIENT_URL | Set CORS origin to exact frontend URL |
| Socket.io won't connect (no error) | Socket.io CORS mismatch | Match Socket.io CORS to Express CORS exactly |
| Real-time features stop after ~15 min | JWT expired, WebSocket using stale token | Token refresh listener + socket reconnect |
| Rate limiting blocks everyone | Missing `trust proxy` behind Railway | `app.set('trust proxy', 1)` |
| App shows stale data after mutation | React Query cache not invalidated | Add scoped `invalidateQueries` after every mutation |
| Blank page on Vercel (nested route) | Missing SPA rewrite rule | Add `rewrites` to `vercel.json` |
| Blank page (env var missing) | `VITE_*` var not set or wrong prefix | Add runtime check at app init with helpful error |
| Container keeps restarting on Railway | Health check returning 503 during DB init | Return 200 with `dbConnected: false` |
| Push notifications failing for some users | Stale push tokens | Deactivate on `DeviceNotRegistered` |
| Database queries hang forever | Supabase RLS circular dependency | Use `SECURITY DEFINER` functions |
| Supabase project unreachable | Free tier auto-paused | Upgrade to paid plan |

## Mobile / Expo Errors

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| App Store rejection: blank screen on iPad | No responsive layout | Set `supportsTablet: false` or implement responsive design |
| App Store rejection: broken feature | Non-functional OAuth button | Remove incomplete features before submission |
| `expo-doctor` failure | Metro config overrode default watchFolders | Spread existing values: `[...(config.watchFolders \|\| []), root]` |
| Notification crash in Expo Go | `expo-notifications` unsupported | Wrap setup in try-catch |
| iOS OAuth redirect URI mismatch | Not using reversed client ID domain | Reverse the client ID in app.config.js |

---

# Part 3: Code Templates

## Zod Environment Validation

```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  // Required — no defaults
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),

  // Required with format validation
  PII_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i,
    'Must be 64 hex characters (32 bytes)'),

  // Optional with sensible defaults
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  JWT_EXPIRES_IN: z.string().default('15m'),

  // CORS origins
  FRONTEND_URL: z.string().default('http://localhost:3000'),
  ADMIN_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
```

## Graceful Shutdown

```typescript
// src/index.ts — after server.listen()
const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);

  // 1. Stop accepting new connections
  server.close();

  // 2. Close WebSocket connections (if applicable)
  if (io) io.close();

  // 3. Drain job queues (if applicable)
  // await closeQueues();

  // 4. Close database connection
  await prisma.$disconnect();

  clearTimeout(forceExit);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});
```

## Health Check Endpoint

```typescript
// Health check — always returns 200 (don't block deploys)
app.get('/api/v1/health', async (_req, res) => {
  let dbConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {}

  res.json({
    status: dbConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    dbConnected,
    version: process.env.npm_package_version ?? '0.0.0',
  });
});
```

## Prisma Singleton

```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? ['query', 'error', 'warn']
    : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

## Express Production Middleware Stack

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// 1. Trust reverse proxy (Railway, Heroku, AWS ELB)
app.set('trust proxy', 1);

// 2. Security headers
app.use(helmet());

// 3. CORS
const origins = [env.FRONTEND_URL, env.ADMIN_URL].filter(Boolean);
app.use(cors({ origin: origins, credentials: true }));

// 4. Body parser with size limit
app.use(express.json({ limit: '1mb' }));

// 5. Rate limiting
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));
```

## Error Handler Middleware

```typescript
// src/middleware/errorHandler.ts
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code: string = 'BAD_REQUEST',
  ) {
    super(message);
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      data: null,
      error: { code: err.code, message: err.message },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      data: null,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.flatten().fieldErrors,
      },
    });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}
```

## LLM Response Parser

```typescript
// src/lib/llm.ts
function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '');
}

export function parseLLMJson<T>(raw: string, fallback: T): T {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const cleaned = stripCodeFences(raw.trim());
      return JSON.parse(cleaned) as T;
    } catch {
      if (attempt === 0) continue;
    }
  }
  return fallback;
}
```

## Frontend Runtime Env Check

```typescript
// src/main.tsx or src/App.tsx
const REQUIRED_VAR = import.meta.env.VITE_API_KEY as string;
if (!REQUIRED_VAR) {
  throw new Error(
    'Missing VITE_API_KEY environment variable. ' +
    'Copy .env.example to .env and fill in your values.'
  );
}
```

## Socket.io CORS + Express CORS (shared origins)

```typescript
const allowedOrigins = [env.FRONTEND_URL, env.ADMIN_URL].filter(Boolean);

// Express
app.use(cors({ origin: allowedOrigins, credentials: true }));

// Socket.io — MUST match
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
});

// Client-side: always add error logging
socket.on('connect_error', (err) => {
  console.error('Socket connect error:', err.message);
});
```

---

# Part 4: Stack-Specific Checklists

See the full checklists in `checklists/`:
- `pre-deploy-nextjs-vercel-supabase.md`
- `pre-deploy-vite-vercel.md`
- `pre-deploy-express-railway.md`
- `pre-deploy-expo-eas.md`

---

# Part 5: Lesson Index by Project

| Project | File | Count | Primary themes |
|---------|------|-------|----------------|
| RatRacer | `lessons/ratracer-lessons.md` | 10 | Vercel env vars, Prisma, NextAuth, OAuth, Tailwind v4 |
| PointPartner | `lessons/pointpartner-lessons.md` | 13 | NEXT_PUBLIC_ build-time, Railway CLI, monorepo, PWA |
| Portfolio | `lessons/justinpinero-portfolio-lessons.md` | 7 | Vitest/Vite versions, React 18 types, pnpm |
| medipal | `lessons/medipal-lessons.md` | 14 | Docker, health checks, WebSocket JWT, graceful shutdown |
| Site-Unseen | `lessons/site-unseen-lessons.md` | 10 | Socket.io CORS, zombie processes, race conditions |
| HR Hero | `lessons/hr-hero-lessons.md` | 9 | NIXPACKS, CORS proxy masking, AI JSON parsing |
| DocDoc | `lessons/docdoc-lessons.md` | 6 | Clerk CSP, VITE_ prefix, deployment config tests |
| MonsterMash | `lessons/monstermash-lessons.md` | 6 | API key exposure, Vercel serverless routing |
| E1C | `lessons/e1c-lessons.md` | 10 | App Store rejection, RLS recursion, Expo Go |
| GYLR2 | `lessons/gylr2-lessons.md` | 8 | iOS OAuth redirect, token refresh, rate limiting |
| ARC | `lessons/arc-lessons.md` | 10 | pnpm+Docker symlinks, esbuild, db push vs migrate |
