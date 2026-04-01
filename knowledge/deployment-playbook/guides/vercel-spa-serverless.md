# Vercel Deployment Guide — SPA + Serverless

> Covers Next.js, Vite, and serverless function patterns from
> DocDoc, MonsterMash, Site-Unseen, PointPartner, RatRacer, and ARC.

---

## SPA Rewrite Rule (Required for Every SPA)

Without this, refreshing on `/tools/roster` or sharing a direct link returns 404.

```json
// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Test:** Navigate directly to a nested route in the deployed preview. If it 404s, the rewrite is missing.

---

## Monorepo Build Commands

### Turbo + pnpm (recommended)
```json
{
  "installCommand": "cd ../.. && pnpm install",
  "buildCommand": "cd ../.. && pnpm turbo build --filter=@your-app/web...",
  "outputDirectory": ".next"
}
```

The `...` suffix includes transitive dependencies. Without it, shared packages don't build.

### npm workspaces
```json
{
  "buildCommand": "npm install && npm run build --workspace=front",
  "outputDirectory": "front/dist"
}
```

**Key rule:** For monorepos, `vercel.json` goes at the repo root so Vercel can see all workspaces (Site-Unseen #1).

---

## Serverless Functions (API Proxy Pattern)

For protecting API keys from client exposure (MonsterMash #1):

```
api/
├── claude/
│   └── v1/
│       └── messages.ts     → POST /api/claude/v1/messages
└── tmdb/
    ├── search/
    │   └── movie.ts        → GET /api/tmdb/search/movie
    └── movie.ts            → GET /api/tmdb/movie?id=123
```

**File-based routing rules:**
- File path = route path
- **Use query params, not path params** — `movie.ts` handles `/api/tmdb/movie?id=123`, NOT `/api/tmdb/movie/123` (MonsterMash #2)
- For path params, use bracket notation: `[id].ts`

**Proxy function template:**
```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await fetch('https://api.external-service.com/endpoint', {
    method: req.method,
    headers: {
      'x-api-key': process.env.SECRET_API_KEY!, // Server-side only
      'content-type': 'application/json',
    },
    body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
  });
  res.status(response.status).json(await response.json());
}
```

**Dev parity:** Use Vite's dev proxy to match production routes:
```typescript
// vite.config.ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' = load ALL vars (not just VITE_)
  return {
    server: {
      proxy: {
        '/api/external': {
          target: 'https://api.external-service.com',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.SECRET_API_KEY);
            });
          },
        },
      },
    },
  };
});
```

---

## Security Headers

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      {
        "key": "Content-Security-Policy",
        "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://*.your-auth-provider.com; frame-src https://*.your-auth-provider.com; object-src 'none'"
      }
    ]
  }]
}
```

**Clerk requires:** `connect-src` + `frame-src` for `*.clerk.accounts.dev` and `api.clerk.com` (DocDoc #1).

**Test CSP in CI** — don't rely on manual checks (DocDoc #6):
```typescript
it('should have CSP with auth provider domains', async () => {
  const config = JSON.parse(fs.readFileSync('vercel.json', 'utf-8'));
  const csp = config.headers[0].headers.find(h => h.key === 'Content-Security-Policy');
  expect(csp.value).toContain('clerk');
  expect(csp.value).not.toContain('unsafe-eval');
});
```

---

## Common Gotchas

| Issue | Symptom | Fix |
|-------|---------|-----|
| Missing SPA rewrite | Direct URL navigation returns 404 | Add `rewrites` to vercel.json |
| `VITE_` prefix on secrets | API keys visible in browser | Use serverless proxy |
| Monorepo vercel.json in subdirectory | Can't resolve workspace deps | Move to repo root |
| Preview env vars not set | Preview deploys break | Set vars for all 3 environments |
| Clerk CSP missing | Auth silently fails | Add `connect-src` + `frame-src` |
| `echo` for env vars | Trailing newline breaks OAuth | Use `printf` |
| Turbo filter without `...` | Shared packages don't build | Use `--filter=@app/web...` |

---

## Checklist

- [ ] SPA rewrite rule in `vercel.json`
- [ ] Security headers configured (CSP, X-Frame-Options, etc.)
- [ ] API keys use serverless proxy (not `VITE_`/`NEXT_PUBLIC_` prefix)
- [ ] Monorepo builds from root with workspace filtering
- [ ] Environment variables set for Production, Preview, AND Development
- [ ] `vercel.json` at repo root for monorepos
- [ ] Dev proxy matches production serverless routes
- [ ] CSP tested in CI
