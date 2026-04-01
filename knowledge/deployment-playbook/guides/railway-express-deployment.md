# Railway + Express Deployment Guide

> From medipal, site-unseen, hr_hero, and ARC.
> Covers NIXPACKS, Docker, health checks, graceful shutdown, and CORS.

---

## Deployment Modes

### NIXPACKS (simpler, for non-monorepo)

```toml
# railway.toml
[build]
builder = "NIXPACKS"

[build.nixpacks]
installCmd = "npm ci"
buildCmd = "npx prisma generate && npm run build"

[deploy]
startCommand = "npx prisma migrate deploy && npm start"
healthcheckPath = "/api/health"
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

For monorepos with NIXPACKS, chain `cd` commands (HR Hero #2):
```toml
installCmd = "cd client && npm ci && cd ../server && npm ci"
buildCmd = "cd client && npm run build && cd ../server && npx prisma generate && npm run build"
startCommand = "cd server && npx prisma migrate deploy && npm start"
```

### Docker (for pnpm monorepos)

```toml
[build]
builder = "dockerfile"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 120
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

See the [Docker + pnpm Monorepo Guide](./docker-pnpm-monorepo.md) for Dockerfile patterns.

---

## Express Production Configuration

### The essential middleware stack

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// 1. Trust Railway's reverse proxy (REQUIRED)
app.set('trust proxy', 1);

// 2. Security headers
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } },
}));

// 3. CORS — must exactly match frontend URL
app.use(cors({
  origin: [env.FRONTEND_URL, env.ADMIN_URL].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// 4. Body parser with size limit
app.use(express.json({ limit: '1mb' }));

// 5. Rate limiting (requires trust proxy!)
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// 6. Health check (before auth middleware)
app.get('/api/v1/health', async (req, res) => {
  let dbConnected = false;
  try { await prisma.$queryRaw`SELECT 1`; dbConnected = true; } catch {}
  // Always return 200 — don't block deploys during DB init
  res.json({ status: dbConnected ? 'ok' : 'degraded', dbConnected });
});

// 7. Routes
app.use('/api/v1', routes);

// 8. Error handler (last)
app.use(errorHandler);
```

### Why `trust proxy` matters

Without it, `req.ip` returns the Railway proxy's IP, not the client's IP. This breaks:
- Rate limiting (all requests share one bucket)
- Logging (all requests look like they're from the same IP)
- Geolocation

### Graceful shutdown (NON-NEGOTIABLE)

```typescript
const server = app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT}`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);

  server.close();                    // Stop accepting new connections
  if (io) io.close();               // Close WebSocket connections
  if (queues) await closeQueues();   // Drain job queues
  await prisma.$disconnect();        // Close DB connections

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

---

## Socket.io on Railway

CORS must be configured separately for Socket.io AND must match Express CORS:

```typescript
const io = new Server(httpServer, {
  cors: {
    origin: env.FRONTEND_URL,  // Must exactly match — no trailing slash
    methods: ['GET', 'POST'],
    credentials: true,
  },
});
```

**Silent failure:** Socket.io CORS mismatches produce NO browser console error (Site-Unseen #4). Add client-side error logging:

```typescript
socket.on('connect_error', (err) => {
  console.error('Socket connect error:', err.message);
});
```

---

## Multi-Service Projects

Always specify `--service` when deploying (Medipal #7):

```bash
railway up --detach --service my-api-service
```

Without this, Railway doesn't know which service to target.

---

## Post-Deploy Smoke Tests

```yaml
# .github/workflows/deploy.yml
smoke-test:
  needs: deploy
  steps:
    - name: Wait for startup
      run: sleep 30
    - name: Health check
      run: |
        curl --fail --retry 5 --retry-delay 10 \
          ${{ secrets.PRODUCTION_API_URL }}/health
    - name: Verify DB connection
      run: |
        STATUS=$(curl -s ${{ secrets.PRODUCTION_API_URL }}/health | jq -r '.dbConnected')
        [ "$STATUS" = "true" ] || exit 1
    - name: Error handling check
      run: |
        CODE=$(curl -s -o /dev/null -w "%{http_code}" \
          -X POST ${{ secrets.PRODUCTION_API_URL }}/auth/login \
          -H "Content-Type: application/json" -d '{}')
        [ "$CODE" = "400" ] || [ "$CODE" = "429" ] || exit 1
```

---

## Checklist

- [ ] `trust proxy` set to `1`
- [ ] CORS origins match frontend URL exactly (no trailing slash, correct protocol)
- [ ] Socket.io CORS matches Express CORS
- [ ] Health check returns 200 even during DB init (use `dbConnected` field)
- [ ] Graceful shutdown handles SIGTERM/SIGINT
- [ ] Rate limiting configured (requires trust proxy)
- [ ] `--service` flag used in Railway CLI for multi-service projects
- [ ] Health check timeout ≥ 120s for first deploy
- [ ] Post-deploy smoke tests in CI
- [ ] Prisma generate runs before TypeScript compilation
