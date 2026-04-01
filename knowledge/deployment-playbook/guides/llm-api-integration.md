# LLM API Integration in Production

> From HR Hero, MonsterMash, and GYLR2.
> Every project using Claude hit the same issues.

---

## 1. Never expose API keys client-side

```
VITE_CLAUDE_API_KEY     ← WRONG: bundled into JS, visible to anyone
EXPO_PUBLIC_CLAUDE_KEY  ← WRONG: compiled into app binary
CLAUDE_API_KEY          ← RIGHT: server-side only
```

**Pattern:** Server-side proxy (see [Vercel guide](./vercel-spa-serverless.md) for serverless function template).

---

## 2. Always expect JSON parse failures

Claude sometimes wraps JSON in markdown code fences even when asked for raw JSON:

````
```json
{"matches": [...]}
```
````

**Strip before parsing:**
```typescript
function stripCodeFences(text: string): string {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
}

function parseClaudeJSON<T>(text: string): T {
  const cleaned = stripCodeFences(text.trim());
  return JSON.parse(cleaned);
}
```

**Add retry logic** (HR Hero #8):
```typescript
for (let attempt = 0; attempt < 2; attempt++) {
  try {
    return parseClaudeJSON(block.text);
  } catch {
    if (attempt === 0) continue;
    throw new Error('Failed to parse AI response');
  }
}
```

**Validate every field** with fallback defaults:
```typescript
const result = {
  score: typeof parsed.score === 'number' ? parsed.score : 50,
  reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning provided',
};
```

---

## 3. Set timeouts on all API calls

LLM APIs are slow and can hang. Always use AbortController:

```typescript
const TIMEOUT_MS = 15_000; // 15 seconds
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: { 'x-api-key': env.CLAUDE_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  // ...
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    throw new AppError('Request timed out', 408);
  }
  throw error;
} finally {
  clearTimeout(timeoutId);
}
```

---

## 4. Rate limiting is essential

Two layers prevent cost overruns:

**Client-side** — throttle + cache (GYLR2 #7):
```typescript
const RATE_LIMIT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Content-based cache key
function cacheKey(data: unknown[], period: string): string {
  return `${period}-${JSON.stringify(data)}`;
}
```

**Server-side** — per-IP + global daily cap (HR Hero):
```typescript
// Per-IP: 10 requests / 15 minutes
const aiRateLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 });

// Global daily cap: 200 requests
let dailyCount = 0;
setInterval(() => { dailyCount = 0; }, 24 * 60 * 60 * 1000);
```

**Note:** In-memory counters reset on restart and are per-instance. Use Redis for production multi-instance deployments.

---

## 5. Cache successful responses

LLM responses are expensive. Cache them in the database:

```typescript
// Check cache first
const cached = await prisma.aiMatch.findUnique({
  where: { heroId_positionId: { heroId, positionId } },
});
if (cached) return cached;

// Generate and cache
const result = await generateMatch(hero, position);
await prisma.aiMatch.create({ data: { heroId, positionId, ...result } });
return result;
```

---

## Checklist

- [ ] API keys are server-side only (no `VITE_`, `NEXT_PUBLIC_`, `EXPO_PUBLIC_`)
- [ ] JSON responses stripped of code fences before parsing
- [ ] Field validation with fallback defaults on every parsed response
- [ ] AbortController timeout on all API calls (15s recommended)
- [ ] Client-side rate limiting with countdown UI
- [ ] Server-side rate limiting (per-IP + global cap)
- [ ] Successful responses cached in database
- [ ] Retry logic for intermittent parse failures
- [ ] User-friendly error messages for 401, 429, 500, timeout
