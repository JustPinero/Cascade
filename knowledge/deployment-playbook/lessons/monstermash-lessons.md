# MonsterMash — Deployment Lessons

## Stack
React 19 + Vite 7 + TypeScript 5.9, Zustand, Framer Motion, Vercel (with Serverless Functions), TMDB API, Claude API

---

## 1. API keys exposed in client bundle via `VITE_` prefix

### Symptom
Security audit flagged that TMDB and Claude API keys were visible in the browser's DevTools Network tab and in the built JavaScript bundle.

### Root Cause
API keys were stored as `VITE_TMDB_API_KEY` and `VITE_CLAUDE_API_KEY`. Vite inlines all `VITE_`-prefixed env vars into the client bundle at build time. Anyone could extract them from the deployed site.

### Fix
Removed `VITE_` prefix and implemented a server-side proxy pattern:
1. **Development:** Vite dev proxy intercepts `/api/*` calls and injects API keys server-side
2. **Production:** Vercel Serverless Functions proxy the same routes

```typescript
// vite.config.ts (dev only)
proxy: {
  '/api/claude': {
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/claude/, ''),
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('x-api-key', env.CLAUDE_API_KEY);
      });
    },
  },
}
```

```typescript
// api/claude/v1/messages.ts (Vercel serverless function)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.CLAUDE_API_KEY!,
      'content-type': 'application/json',
    },
    body: JSON.stringify(req.body),
  });
  res.status(response.status).json(await response.json());
}
```

### Prevention
- **NEVER use `VITE_` prefix for API keys or secrets** — they get bundled into client JS
- Use server-side proxies (Vercel Serverless Functions, API routes, BFF) to inject secrets
- Only use `VITE_` for truly public values (feature flags, public IDs, analytics keys)
- Add a pre-commit hook or CI check that flags `VITE_.*KEY` or `VITE_.*SECRET` patterns

### Time to Diagnose
~N/A (caught in security audit, not in production)

---

## 2. Vercel file-based routing doesn't support path parameters — use query params

### Symptom
`/api/tmdb/movie/12345` returned 404 in production on Vercel, even though the serverless function existed at `api/tmdb/movie.ts`.

### Root Cause
Vercel's serverless function routing maps files to routes: `api/tmdb/movie.ts` → `/api/tmdb/movie`. Path segments after this (like `/12345`) don't get routed to the same function. Unlike Express, Vercel doesn't support `:id` path params in file names without special `[id].ts` bracket syntax.

### Fix
Switched from path params to query params:
```typescript
// Client: /api/tmdb/movie?id=12345 (not /api/tmdb/movie/12345)
const res = await fetch(`/api/tmdb/movie?id=${movieId}`);

// Serverless function: read from query
const id = req.query.id;
```

### Prevention
- **For Vercel serverless functions, prefer query params over path params** unless using bracket notation (`[id].ts`)
- Bracket notation (`api/tmdb/movie/[id].ts`) works but adds file complexity
- Query params are simpler and work consistently across Vercel, Netlify, and other serverless platforms
- Document the route structure so frontend devs know the pattern

### Time to Diagnose
~10 minutes

---

## 3. Dual proxy pattern — dev proxy and production serverless must match routes

### Symptom
API calls worked in development but returned 404 in production (or vice versa) because the Vite dev proxy and Vercel serverless functions had different route structures.

### Root Cause
The Vite dev proxy rewrites paths before forwarding. If the rewrite logic differs from the Vercel function's file path, the routes don't match. Example: dev proxy strips `/api/claude` prefix, but the serverless function expects the full path.

### Fix
Ensured both environments serve identical route patterns:
- Client always calls `/api/claude/v1/messages`, `/api/tmdb/search/movie`, `/api/tmdb/movie`
- Vite proxy rewrites to upstream APIs (strips `/api/claude` or `/api/tmdb` prefix)
- Vercel functions at matching paths forward to the same upstreams

### Prevention
- **Write a route table** that documents what the client calls, what dev proxy does, and what production serves
- Test with `npm run build && npx vercel dev` locally to catch mismatches before deploy
- Keep MSW test handlers aligned with the same routes

### Time to Diagnose
~15 minutes

---

## 4. `loadEnv` with empty prefix reads all env vars without exposing to client

### Symptom
Vite dev proxy couldn't read `CLAUDE_API_KEY` from `.env` because it didn't have the `VITE_` prefix.

### Root Cause
By default, `import.meta.env` only exposes `VITE_`-prefixed variables. The proxy config runs in Vite's Node.js context (not the browser), but `defineConfig` doesn't automatically load non-prefixed vars.

### Fix
Used `loadEnv` with an empty prefix string:
```typescript
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');  // '' = load ALL vars
  return {
    server: {
      proxy: {
        '/api/claude': {
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.CLAUDE_API_KEY);
            });
          },
        },
      },
    },
  };
});
```

### Prevention
- **`loadEnv(mode, root, '')` with empty third arg loads ALL env vars** — use this in `vite.config.ts` for server-side-only access
- These vars are only available in the Vite config (Node.js), never in client code
- This is the correct pattern for proxy auth headers, not `VITE_`-prefixed secrets

### Time to Diagnose
~5 minutes

---

## 5. Claude API returns JSON wrapped in markdown code fences

### Symptom
`JSON.parse()` threw `SyntaxError` intermittently when parsing Claude's response for date scenario generation.

### Root Cause
Claude sometimes wraps JSON responses in markdown code fences (`` ```json\n{...}\n``` ``) even when the prompt asks for raw JSON. The markdown wrapper makes `JSON.parse()` fail.

### Fix
Added a `stripCodeFences` utility that runs before parsing:
```typescript
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}
```

Also added field validation with defaults for malformed responses.

### Prevention
- **Always strip markdown code fences before parsing LLM JSON responses**
- Add fallback defaults for every expected field
- This is the same issue as HR Hero lesson #8 — it's a universal LLM integration gotcha
- Consider using Claude's structured output mode or JSON mode when available

### Time to Diagnose
~5 minutes (intermittent, needed to catch it happening)

---

## 6. `localStorage.setItem` can throw in private browsing mode

### Symptom
App crashed with `QuotaExceededError` when a user in Safari private browsing mode tried to save monster data via Zustand's `persist` middleware.

### Root Cause
Safari's private browsing mode has a 0-byte localStorage quota. Any `setItem` call throws `QuotaExceededError`. Zustand's persist middleware calls `setItem` on every state change.

### Fix
Wrapped all localStorage operations in try-catch:
```typescript
const storage = {
  getItem: (name: string) => {
    try { return localStorage.getItem(name); }
    catch { return null; }
  },
  setItem: (name: string, value: string) => {
    try { localStorage.setItem(name, value); }
    catch { /* silently fail — state still works in memory */ }
  },
  removeItem: (name: string) => {
    try { localStorage.removeItem(name); }
    catch {}
  },
};
```

### Prevention
- **Always wrap localStorage in try-catch** — private browsing, full storage, and disabled storage all throw
- For Zustand persist: pass a custom `storage` implementation with error handling
- The app should work without persistence (memory-only fallback)

### Time to Diagnose
~3 minutes

---

# Summary

**Total issues found:** 6

**Top 3 most time-consuming to diagnose:**
1. **Dual proxy route mismatch** (~15 min) — routes worked in dev but not production
2. **Vercel file-based routing vs path params** (~10 min) — unexpected 404 in production
3. **API key exposure in client bundle** (~N/A, caught in audit) — architectural issue

**Patterns identified:**
- **2 API security issues** (#1, #4) — API keys must never touch the client; Vite's `loadEnv` with empty prefix is the correct pattern
- **2 Vercel serverless routing issues** (#2, #3) — file-based routing has different semantics than Express routing
- **1 LLM integration issue** (#5) — JSON-from-LLM always needs defensive parsing (3rd project with this pattern)
- **1 browser storage issue** (#6) — localStorage fails in private browsing; always wrap in try-catch
