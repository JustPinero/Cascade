# Prisma in Production — Every Gotcha

> From RatRacer, medipal, HR Hero, ARC, and Site-Unseen.
> Prisma deployment issues appeared in 5 of 11 projects.

---

## Build Pipeline: The Correct Order

```
1. pnpm install (or npm ci)
2. prisma generate          ← BEFORE TypeScript compilation
3. tsc (or next build)      ← Now @prisma/client types exist
```

### In package.json
```json
{
  "build": "prisma generate && tsc",
  "postinstall": "prisma generate"
}
```

`postinstall` covers fresh installs. `build` covers cached `node_modules` (Vercel caches between deploys).

### In Docker
```dockerfile
RUN pnpm --filter @your-app/db exec prisma generate
RUN pnpm turbo build
```

### In CI
```yaml
- run: npx prisma generate
- run: npm run build
- run: npm test
```

---

## Connection Strings

### Supabase
```
# Transaction Pooler (for Vercel/serverless):
postgresql://postgres.[ref]:[password]@aws-1-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct (for migrations only):
postgresql://postgres.[ref]:[password]@aws-0-us-west-1.supabase.com:5432/postgres
```

**Key points:**
- `aws-1-` = IPv4 (works from Vercel). `aws-0-` = IPv6 (doesn't work from Vercel)
- Port `6543` = pooler. Port `5432` = direct
- `?pgbouncer=true` required for transaction pooler

### With connection pooling
Use `DIRECT_URL` for migrations (bypasses PgBouncer):
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

---

## First Deploy: `db push` vs `migrate deploy`

| Command | Use When |
|---------|----------|
| `prisma db push` | Fresh database, no migration history |
| `prisma migrate deploy` | Existing database with migration history |
| `prisma migrate dev` | Local development only (prompts, never in prod) |

On first deploy to a new Railway database, use `db push` (ARC #4). After that, switch to `migrate deploy`.

---

## Prisma Client in Docker

1. **Generate in the final stage** — don't copy generated artifacts between Docker stages:
   ```dockerfile
   RUN pnpm --filter @your-app/db exec prisma generate
   ```

2. **`@prisma/client` must be a direct dependency** of any package that imports it (in pnpm strict mode):
   ```json
   { "dependencies": { "@prisma/client": "^6.0.0" } }
   ```

3. **Run Prisma from the schema-owning package** — in monorepos, `npx prisma` from root may not find the schema:
   ```bash
   pnpm --filter @your-app/db exec prisma generate
   # NOT: npx prisma generate --schema=packages/db/prisma/schema.prisma
   ```

---

## Singleton Pattern

Prevents connection pool exhaustion during hot reload:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## Seeding

**Idempotent seeds** — check before inserting (HR Hero #4):
```typescript
const count = await prisma.hero.count();
if (count >= 700) {
  console.log('Already seeded, skipping.');
  return;
}
```

**Seed scripts that call external APIs** (like SuperHero API) take 2-3 minutes. Plan for slow first deploys.

---

## Checklist

- [ ] `prisma generate` runs before TypeScript compilation (in build AND postinstall)
- [ ] Connection string uses transaction pooler for serverless (port 6543, `?pgbouncer=true`)
- [ ] `DIRECT_URL` set for migrations when using connection pooler
- [ ] First deploy uses `db push`, subsequent deploys use `migrate deploy`
- [ ] Prisma client is a direct dependency in pnpm strict mode
- [ ] Singleton pattern prevents connection pool exhaustion
- [ ] Seed scripts are idempotent
- [ ] Prisma generate runs from the schema-owning package in monorepos
