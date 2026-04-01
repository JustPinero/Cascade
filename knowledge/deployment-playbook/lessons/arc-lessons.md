# ARC (FriendsProjects) — Deployment Lessons

## Stack
Next.js 14 (Web), Vite + React (Admin), Expo (Mobile), Express + Socket.io (API), PostgreSQL + Prisma 6, Turborepo + pnpm, Vercel (Web + Admin), Railway (API + DB)

---

## 1. pnpm symlinks break in multi-stage Docker builds

### Symptom
Multi-stage Docker build succeeded, but runtime crashed with `MODULE_NOT_FOUND` errors. Dependencies that existed in the builder stage were missing in the runner stage.

### Root Cause
`COPY --from=builder` dereferences pnpm's virtual store symlinks. pnpm uses symlinks to share packages across workspaces. When Docker copies files between stages, it copies the symlink targets, not the symlink structure — breaking pnpm's resolution.

### Fix
Switched to a single-stage build that preserves pnpm's symlink structure:
```dockerfile
FROM node:20-slim
RUN corepack enable && corepack prepare pnpm@9 --activate
RUN npm install -g esbuild prisma@6

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm --filter @arc/db exec prisma generate
RUN esbuild src/index.ts --bundle --platform=node --target=node20 \
  --outfile=dist/index.js --external:bcrypt --external:@prisma/client
```

### Prevention
- **For pnpm monorepos, use single-stage Docker builds** — multi-stage breaks symlinks
- Alternative: use `pnpm deploy` command which creates a standalone directory without symlinks
- Test Docker builds locally with `docker build && docker run` before pushing

### Time to Diagnose
~1 hour (multiple iterations across commits 157d252, 914c164)

---

## 2. esbuild `--packages=external` excludes workspace packages

### Symptom
esbuild bundle produced, but runtime failed with "cannot find module @arc/shared" and "cannot find module @arc/db."

### Root Cause
Using `--packages=external` tells esbuild to treat ALL imports as external (not bundled). This includes workspace packages (`@arc/shared`, `@arc/db`), which don't exist in `node_modules` in the expected format.

### Fix
Only externalize packages that truly must be external (native addons and generated code):
```bash
esbuild src/index.ts --bundle --platform=node --target=node20 \
  --outfile=dist/index.js \
  --external:bcrypt \        # Native addon
  --external:@prisma/client  # Generated code
```

Everything else (including workspace packages) gets bundled.

### Prevention
- **Don't use `--packages=external` in monorepos** — it excludes workspace packages
- Only externalize packages that can't be bundled (native addons, generated code)
- Test the bundle with `node dist/index.js` after building

### Time to Diagnose
~30 minutes

---

## 3. `@prisma/client` must be direct dependency in pnpm strict mode

### Symptom
Runtime error: `Cannot find module '@prisma/client'` even though `@arc/db` (which depends on `@prisma/client`) was a dependency of `@arc/api`.

### Root Cause
pnpm's strict mode only creates symlinks for **direct** dependencies. `@arc/api` depended on `@arc/db`, which depended on `@prisma/client`. But since `@prisma/client` wasn't a direct dependency of `@arc/api`, pnpm didn't create a symlink for it. esbuild's `--external:@prisma/client` directive meant the bundle references it at runtime, but it's not there.

### Fix
Added `@prisma/client` as a direct dependency of `@arc/api`:
```json
{
  "dependencies": {
    "@prisma/client": "^6.0.0"
  }
}
```

### Prevention
- **In pnpm strict mode, packages used at runtime must be direct dependencies** — transitive deps aren't accessible
- If you externalize a package from your bundle, it MUST be a direct dep
- This is especially important with `@prisma/client` which is externalized from bundles

### Time to Diagnose
~15 minutes

---

## 4. `prisma db push` needed for first deploy — `migrate deploy` fails on empty DB

### Symptom
`prisma migrate deploy` failed on Railway with no tables created. The database was fresh with no migration history.

### Root Cause
`migrate deploy` expects existing migration history files. On a fresh database with no prior migrations, it has nothing to apply.

### Fix
Used `prisma db push` for initial schema sync:
```bash
prisma db push --schema=packages/db/prisma/schema.prisma --skip-generate --accept-data-loss
```

### Prevention
- **Use `db push` for first deploy on empty databases**, `migrate deploy` for subsequent deploys
- The startup script should detect whether migration history exists and choose accordingly
- `--accept-data-loss` is safe on empty databases but dangerous on databases with data

### Time to Diagnose
~10 minutes

---

## 5. CLI tools (`esbuild`, `prisma`, `tsx`) need global install in Docker

### Symptom
Docker build failed — `esbuild: command not found` or `prisma: command not found` during build or runtime.

### Root Cause
pnpm's `node_modules/.bin` symlinks don't work reliably in Docker. Running `npx esbuild` or `pnpm exec prisma` failed because the binary couldn't be resolved through pnpm's virtual store.

### Fix
Install CLI tools globally:
```dockerfile
RUN npm install -g esbuild prisma@6 tsx
```

### Prevention
- **In Docker + pnpm, install CLI tools globally with `npm install -g`**
- This bypasses pnpm's symlink resolution entirely
- Pin versions to avoid surprises (`prisma@6`, not just `prisma`)

### Time to Diagnose
~10 minutes (multiple iterations)

---

## 6. Railway healthcheck timeout too short for Prisma operations

### Symptom
Railway killed the container during first deploy. Health check failed because `prisma db push` + seed took longer than the 30-second timeout.

### Root Cause
Default Railway healthcheck timeout is 30 seconds. On first deploy, the startup script runs schema sync and seeding, which can take 45+ seconds.

### Fix
Increased timeout to 120 seconds in `railway.toml`:
```toml
[deploy]
healthcheckPath = "/api/v1/health"
healthcheckTimeout = 120
restartPolicyMaxRetries = 5
```

### Prevention
- **Set Railway healthcheck timeout to 120s for apps with database initialization**
- Calculate worst-case startup time: install → schema sync → seed → server listen
- Health check should return 200 quickly once the server starts (not block on DB)

### Time to Diagnose
~10 minutes

---

## 7. Dockerfile COPY syntax — no shell redirects in BuildKit

### Symptom
Docker build failed with cryptic error about file "2>/dev/null" not found.

### Root Cause
Attempted to use shell redirect syntax in a COPY instruction:
```dockerfile
# WRONG — BuildKit interprets "2>/dev/null" as a filename
COPY --from=builder /app/packages/api/node_modules ./packages/api/node_modules 2>/dev/null || true
```

### Fix
Use `RUN mkdir -p` instead:
```dockerfile
RUN mkdir -p packages/api/node_modules packages/db/node_modules
```

### Prevention
- **COPY instructions in Docker don't support shell syntax** — no redirects, no pipes, no `||`
- Use `RUN` for anything that needs shell features
- BuildKit (used by Railway and Vercel) is stricter than legacy Docker builder

### Time to Diagnose
~5 minutes

---

## 8. CORS must match between Express and Socket.io

### Symptom
HTTP API calls worked but Socket.io connections failed with CORS errors in production.

### Root Cause
Express CORS and Socket.io CORS were configured with different origin lists. Socket.io's CORS was missing one of the frontend origins.

### Fix
Share the origin array:
```typescript
const origins = [env.NEXT_PUBLIC_APP_URL, env.ADMIN_URL];

// Express
app.use(cors({ origin: origins, credentials: true }));

// Socket.io
const io = new Server(httpServer, {
  cors: { origin: origins, methods: ['GET', 'POST'], credentials: true },
});
```

### Prevention
- **Express and Socket.io CORS origins must be identical** — extract to a shared variable
- This is the same issue as medipal lesson (Socket.io CORS) and site-unseen lesson #4
- Test WebSocket connections immediately after every deploy

### Time to Diagnose
~10 minutes

---

## 9. Conditional seeding prevents data overwrites on redeploy

### Symptom
Not a bug — a proactive measure. Without a check, `prisma seed` runs on every deploy and could overwrite production data.

### Fix
Startup script checks if database is empty before seeding:
```bash
NEEDS_SEED=$(cd /app/packages/db && node -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.count().then(c => {
    console.log(c === 0 ? 'yes' : 'no');
    return p.\$disconnect();
  }).catch(() => { console.log('yes'); });
")

if [ "$NEEDS_SEED" = "yes" ]; then
  cd /app/packages/db && npx tsx prisma/seed.ts
fi
```

Force reseed via env var: `FORCE_RESEED=true`

### Prevention
- **Seed scripts must be idempotent** — check for existing data before inserting
- Provide a force-reseed mechanism via env var for deliberate resets
- This is the same pattern as HR Hero lesson #4

### Time to Diagnose
~N/A (proactive)

---

## 10. `shamefully-hoist=true` required for Expo/Metro in pnpm monorepo

### Symptom
Expo Metro bundler couldn't resolve React Native dependencies. Build errors about missing modules.

### Root Cause
pnpm's default strict hoisting isolates packages. Metro bundler (used by React Native) expects a flat `node_modules` structure to resolve dependencies.

### Fix
Added to `.npmrc`:
```
shamefully-hoist=true
```

### Prevention
- **Expo/React Native projects in pnpm monorepos need `shamefully-hoist=true`**
- This flattens `node_modules` to work with Metro's module resolution
- Only needed if the monorepo includes a React Native/Expo app
- Alternative: use Yarn with workspaces (which hoists by default)

### Time to Diagnose
~10 minutes

---

# Summary

**Total issues found:** 10

**Top 3 most time-consuming to diagnose:**
1. **pnpm symlinks in multi-stage Docker** (~1 hour) — required multiple build iterations to understand the root cause
2. **esbuild workspace package exclusion** (~30 min) — subtle difference between external and bundled packages
3. **@prisma/client strict mode resolution** (~15 min) — pnpm strict mode only exposes direct dependencies

**Patterns identified:**
- **4 Docker/pnpm issues** (#1, #3, #5, #7) — pnpm's symlink-based architecture creates unique Docker challenges; single-stage builds with global installs are the pragmatic solution
- **2 esbuild bundling issues** (#2, #3) — workspace packages must be bundled, native/generated packages must be external
- **2 database initialization issues** (#4, #9) — `db push` for first deploy, conditional seeding to protect data
- **1 healthcheck timeout issue** (#6) — Railway needs generous timeouts for DB operations at startup
- **1 CORS issue** (#8) — Express and Socket.io CORS must stay in sync

**Meta-lesson:** This project took ~20 deployment iterations to get right. pnpm + Docker + monorepo is a powerful but complex combination. Each tool's assumptions (pnpm symlinks, Docker layer isolation, esbuild bundling) conflict in subtle ways.
