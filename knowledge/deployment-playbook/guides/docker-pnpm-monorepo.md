# Docker + pnpm Monorepo Deployment Guide

> 14 lessons from medipal, ARC, and site-unseen.
> This is the hardest deployment pattern in your stack.
> Each tool's assumptions conflict: pnpm symlinks, Docker layer isolation, esbuild bundling.

---

## The Core Problem

pnpm uses symlinks and a virtual store to share packages across workspaces. Docker's `COPY` instruction dereferences symlinks. Multi-stage builds that copy `node_modules` between stages break pnpm's resolution.

## Proven Patterns

### Pattern 1: Single-Stage Build (recommended for Railway)

Avoids the symlink problem entirely. Larger image, but reliable.

```dockerfile
FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN npm install -g esbuild prisma@6

WORKDIR /app

# Copy workspace configs first (cache layer)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY .npmrc ./

# Copy all workspace package.json files
COPY packages/api/package.json ./packages/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ ./packages/

# Generate Prisma client (from the correct package!)
RUN pnpm --filter @your-app/db exec prisma generate

# Build
RUN pnpm turbo build --filter=@your-app/api...

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "packages/api/dist/index.js"]
```

### Pattern 2: esbuild Bundle (for smaller images)

Bundle workspace packages, externalize only native/generated deps.

```bash
esbuild src/index.ts --bundle --platform=node --target=node20 \
  --outfile=dist/index.js \
  --external:bcrypt \           # Native addon — can't be bundled
  --external:@prisma/client     # Generated code — must stay external
```

**Critical:** Do NOT use `--packages=external` — it excludes workspace packages too (ARC #2).

### Key Rules

1. **Always copy `.npmrc`** into Docker builds — without it, pnpm uses non-hoisted layout and dependencies become unreachable (Medipal #2)

2. **Install CLI tools globally** — `npx prisma`, `npx esbuild`, `npx tsx` don't resolve through pnpm's virtual store in Docker:
   ```dockerfile
   RUN npm install -g esbuild prisma@6 tsx
   ```

3. **Run Prisma generate from the correct package** — in strict pnpm mode, run from the package that owns the schema:
   ```bash
   pnpm --filter @your-app/db exec prisma generate
   ```

4. **Add `@prisma/client` as direct dependency** of any package that imports it — pnpm strict mode only exposes direct deps (ARC #3)

5. **No shell redirects in COPY** — BuildKit doesn't support `2>/dev/null || true` in COPY instructions (ARC #7)

6. **Module format: CommonJS for Node.js** — ESNext module output breaks `node dist/index.js` (Medipal #1)

7. **Every package needs its own `@types/node`** — hoisted types don't exist in Docker isolation (Medipal #3)

---

## Startup Script Pattern

For Railway deployments with database initialization:

```bash
#!/bin/sh
set -e

echo "=== Syncing database schema ==="
prisma db push --schema=packages/db/prisma/schema.prisma --skip-generate

# Conditional seed — only on first deploy
NEEDS_SEED=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count().then(c => {
    console.log(c === 0 ? 'yes' : 'no');
    return p.\$disconnect();
  }).catch(() => { console.log('yes'); });
")

if [ "$NEEDS_SEED" = "yes" ] || [ "$FORCE_RESEED" = "true" ]; then
  echo "=== Seeding database ==="
  cd packages/db && npx tsx prisma/seed.ts && cd ../..
fi

echo "=== Starting server ==="
exec node packages/api/dist/index.js
```

---

## Health Check Configuration

```toml
# railway.toml
[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 120          # 120s — accounts for DB init on first deploy
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 5
```

The health endpoint should return 200 even during DB initialization (Medipal #4):
```typescript
app.get('/api/v1/health', async (req, res) => {
  let dbConnected = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
  } catch {}
  res.json({ status: dbConnected ? 'ok' : 'degraded', dbConnected });
});
```

---

## Checklist

- [ ] Single-stage Dockerfile (no multi-stage with pnpm)
- [ ] `.npmrc` copied into Docker build
- [ ] CLI tools installed globally (`npm install -g`)
- [ ] Prisma generate runs from the schema-owning package
- [ ] `@prisma/client` is a direct dependency of any package that imports it
- [ ] TypeScript output is CommonJS (not ESNext)
- [ ] Each workspace package has `@types/node` in devDependencies
- [ ] Health check timeout ≥ 120s for first deploy
- [ ] Startup script handles schema sync + conditional seeding
- [ ] `--frozen-lockfile` used in Docker installs
