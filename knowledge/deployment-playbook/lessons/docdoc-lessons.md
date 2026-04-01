# DocDoc — Deployment Lessons

## Stack
React 19 + Vite 7 + TypeScript 5.9, Clerk Auth, Vercel, GitHub Actions CI

---

## 1. Clerk auth requires specific CSP directives — silent failure without them

### Symptom
Authentication didn't work in production. The Clerk `<SignIn>` component loaded but couldn't complete the auth flow. No obvious error in the UI.

### Root Cause
Content Security Policy headers blocked Clerk's API and iframe requests. Clerk uses:
- `https://*.clerk.accounts.dev` for authentication API calls (needs `connect-src`)
- `https://*.clerk.accounts.dev` for the secure sign-in iframe (needs `frame-src`)
- `https://api.clerk.com` for session management (needs `connect-src`)

Without these in CSP, the browser silently blocks the requests. The console shows CSP violation notices, but they look like CORS errors.

### Fix
Added Clerk domains to CSP in `vercel.json`:
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [{
      "key": "Content-Security-Policy",
      "value": "default-src 'self'; connect-src 'self' https://*.clerk.accounts.dev https://api.clerk.com; frame-src https://*.clerk.accounts.dev; ..."
    }]
  }]
}
```

### Prevention
- **When using third-party auth (Clerk, Auth0, Firebase Auth), check their CSP requirements**
- Clerk needs both `connect-src` and `frame-src` — missing either causes silent failures
- Test auth in production/preview environments, not just localhost (CSP doesn't apply to localhost)
- Write CI tests that validate CSP includes required domains (DocDoc does this)

### Time to Diagnose
~15 minutes

---

## 2. `VITE_` prefix required for client-side env vars — silent undefined without it

### Symptom
Clerk publishable key was `undefined` in the browser even though it was set in Vercel's environment variables dashboard.

### Root Cause
Vite only exposes environment variables prefixed with `VITE_` to the client bundle. A variable named `CLERK_PUBLISHABLE_KEY` is available server-side but `import.meta.env.CLERK_PUBLISHABLE_KEY` is `undefined` in the browser.

### Fix
Named the variable `VITE_CLERK_PUBLISHABLE_KEY` and added a runtime check:
```typescript
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
if (!PUBLISHABLE_KEY) {
  throw new Error(
    "Missing VITE_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env and add your key."
  );
}
```

### Prevention
- **All client-side env vars in Vite must start with `VITE_`** (Next.js uses `NEXT_PUBLIC_`, Expo uses `EXPO_PUBLIC_`)
- Add a runtime check at app initialization that throws with a helpful error message
- Keep `.env.example` committed with all required variable names (no values)

### Time to Diagnose
~5 minutes

---

## 3. SPA rewrite rule required for client-side routing on Vercel

### Symptom
Navigating to `/tools/roster` via the app worked fine, but refreshing the page or sharing the direct URL returned a Vercel 404.

### Root Cause
Vercel looks for a file matching the URL path. `/tools/roster` doesn't correspond to any file — it's a React Router route. Without a rewrite rule, Vercel returns 404.

### Fix
Added SPA rewrite to `vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Prevention
- **Every SPA on Vercel needs this rewrite rule** — add it immediately when creating `vercel.json`
- This applies to all SPA frameworks (React Router, Vue Router, etc.)
- Test by directly navigating to a nested route in the deployed preview

### Time to Diagnose
~2 minutes

---

## 4. Clerk hash routing prevents full-page reloads during auth

### Symptom
Not a bug — a design decision. Using Clerk's default routing caused full page reloads during sign-in/sign-up flows, losing React state.

### Root Cause
Clerk's default routing uses URL paths (`/sign-in`, `/sign-up`) which trigger Vercel to serve different pages. In an SPA, this causes unnecessary reloads.

### Fix
Used hash-based routing for Clerk:
```tsx
<SignIn routing="hash" />
```
This keeps Clerk's auth flow within hash fragments (`#/sign-in`) that don't trigger page navigation.

### Prevention
- **For SPAs using Clerk, always use `routing="hash"`** to avoid page reload issues
- This works seamlessly with Vercel's SPA rewrite rule
- Hash routing also avoids needing to configure Clerk-specific redirect routes

### Time to Diagnose
~5 minutes

---

## 5. Vercel env vars must be set for all environments (Production, Preview, Development)

### Symptom
Production worked, but preview deployments (PR previews) showed a blank page with a missing key error.

### Root Cause
`VITE_CLERK_PUBLISHABLE_KEY` was only set for the "Production" environment in Vercel's dashboard. Preview deployments use the "Preview" environment, which had no variables set.

### Fix
Set the env var for all three environments in Vercel dashboard: Production, Preview, and Development.

### Prevention
- **When adding env vars to Vercel, always check all three environment checkboxes** (Production, Preview, Development)
- Preview environments are especially important for PR-based review workflows
- Use `vercel env pull` to verify what's actually set

### Time to Diagnose
~3 minutes

---

## 6. Deployment config tested in CI — prevents drift

### Symptom
Not a bug — a pattern worth documenting. DocDoc writes CI tests that validate deployment configuration.

### Root Cause / Rationale
Deployment configs (`vercel.json`) can silently drift — someone removes a header, changes a rewrite, or deletes a CSP directive. Without tests, these regressions are only caught in production.

### Implementation
```typescript
// src/test/deployment/headers.test.ts
it("should have SPA rewrite rule", async () => {
  const config = await loadVercelConfig();
  expect(config.rewrites).toContainEqual({
    source: '/(.*)', destination: '/index.html'
  });
});

it("should have CSP with Clerk domains", async () => {
  const csp = getHeader(config, 'Content-Security-Policy');
  expect(csp).toContain("connect-src");
  expect(csp).toContain("clerk");
  expect(csp).not.toContain("unsafe-eval");
});
```

### Prevention
- **Test your deployment config in CI** — SPA rewrites, security headers, CSP directives
- If someone modifies `vercel.json`, tests catch the regression before deploy
- This is cheap to implement and prevents real production issues

### Time to Diagnose
~N/A (proactive pattern)

---

# Summary

**Total issues found:** 6

**Top 3 most time-consuming to diagnose:**
1. **Clerk CSP requirements** (~15 min) — silent failure that looked like CORS
2. **Vite env var prefix** (~5 min) — common gotcha, silent undefined
3. **Clerk hash routing** (~5 min) — full-page reloads during auth flow

**Patterns identified:**
- **2 Clerk-specific issues** (#1, #4) — third-party auth services have deployment requirements that aren't obvious from their docs
- **2 env var issues** (#2, #5) — `VITE_` prefix and multi-environment setup are common Vercel + Vite gotchas
- **1 SPA routing issue** (#3) — rewrite rule is required for every SPA on Vercel
- **1 CI/testing pattern** (#6) — testing deployment config in CI is an excellent preventive measure
