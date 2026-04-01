# RatRacer Deployment Lessons

## Stack
Next.js 14 (App Router), Supabase PostgreSQL, Vercel, Prisma 5, NextAuth.js v4, Google/GitHub OAuth, Stripe

---

## 1. Vercel env vars get trailing newlines from echo

### Symptom
Google OAuth failed with `invalid_client`. The client ID had `%0A` (newline) at the end in the OAuth URL.

### Root Cause
`echo "value" | vercel env add NAME production` appends `\n` to the value. Google rejected the client ID with the trailing newline.

### Fix
Use `printf` instead of `echo`:
```bash
printf 'your-value-here' | vercel env add ENV_VAR_NAME production
```

### Prevention
Never use `echo` to pipe env vars. Always `printf`. Add this to deployment checklist.

### Time to Diagnose
~45 minutes.

---

## 2. Supabase connection from Vercel — IPv6 vs IPv4 pooler

### Symptom
`PrismaClientInitializationError: Can't reach database server`. App worked locally but failed on Vercel.

### Root Cause
Vercel's serverless functions couldn't connect to Supabase's direct connection (port 5432) or IPv6 pooler (`aws-0-` prefix). Only the IPv4 transaction pooler works from Vercel.

### Fix
Use the IPv4 pooler URL format:
```
postgresql://postgres.[project-ref]:[password]@aws-1-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

Key parts:
- `aws-1-` prefix (IPv4), not `aws-0-` (IPv6)
- Port `6543` (pooler), not `5432` (direct)
- `?pgbouncer=true` query param

### Prevention
Always use the "Transaction Pooler" connection string from Supabase dashboard, not "Direct" or "Session Pooler". Verify it starts with `aws-1-`.

### Time to Diagnose
~2 hours across multiple attempts.

---

## 3. Prisma on Vercel — cached client without generate

### Symptom
`PrismaClientInitializationError` on Vercel even with correct DATABASE_URL. Worked locally.

### Root Cause
Vercel caches `node_modules` between deploys. If the Prisma schema changes but `prisma generate` doesn't run, the cached client doesn't match the schema.

### Fix
Add to `package.json`:
```json
{
  "build": "prisma generate && next build",
  "postinstall": "prisma generate"
}
```

### Prevention
Always include `prisma generate` in both `build` and `postinstall` scripts. The `postinstall` hook covers fresh installs; the `build` script covers cases where dependencies are cached.

### Time to Diagnose
~30 minutes.

---

## 4. NextAuth middleware — JWT vs database sessions

### Symptom
Users could sign in (session cookie was set) but every protected page redirected back to login. Infinite redirect loop.

### Root Cause
Used `export { default } from "next-auth/middleware"` which only validates JWT tokens. The app uses database sessions (`strategy: "database"`), so the JWT-based middleware always rejected the session.

### Fix
Custom middleware that checks the session cookie directly:
```typescript
export function middleware(request: NextRequest): NextResponse {
  const sessionToken =
    request.cookies.get("__Secure-next-auth.session-token") ??
    request.cookies.get("next-auth.session-token");
  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}
```

### Prevention
If using `strategy: "database"`, never use the default NextAuth middleware export. Always write custom middleware that checks the cookie.

### Time to Diagnose
~3 hours. This was the hardest deployment bug.

---

## 5. HTTPS cookie prefix mismatch

### Symptom
Auth worked on localhost but not on production (Vercel). The middleware couldn't find the session cookie.

### Root Cause
On HTTPS (production), the cookie name is `__Secure-next-auth.session-token`. On HTTP (localhost), it's `next-auth.session-token`. The middleware was only checking the localhost name.

### Fix
Check both cookie names (shown in fix #4 above).

### Prevention
Always check both cookie name variants in any custom middleware.

### Time to Diagnose
~1 hour (after fix #4 was already in place).

---

## 6. Next.js API routes fail static analysis during build

### Symptom
`Failed to collect page data for /api/...` during `next build`. Build fails.

### Root Cause
Next.js tries to statically analyze API routes at build time. Routes that call `getSession()` or access environment variables at module scope fail because those aren't available during build.

### Fix
Add to every API route file:
```typescript
export const dynamic = "force-dynamic";
```

### Prevention
Make it a project convention: every file in `src/app/api/` starts with `export const dynamic = "force-dynamic"`. Lint rule or code review check.

### Time to Diagnose
~20 minutes per occurrence, but there were 35 routes.

---

## 7. NextAuth Proxy pattern breaks initialization

### Symptom
`TypeError: Cannot read properties of undefined` during NextAuth initialization. Auth completely broken.

### Root Cause
Attempted to use `new Proxy({} as NextAuthOptions, { get... })` for lazy initialization of auth options. NextAuth's internals call `Object.keys()` and spread on the options object, which hit the empty proxy target.

### Fix
Use a simple lazy singleton instead:
```typescript
let _authOptions: NextAuthOptions | null = null;
export function getAuthOptions(): NextAuthOptions {
  if (!_authOptions) { _authOptions = buildAuthOptions(); }
  return _authOptions;
}
```

### Prevention
Don't use Proxy for config objects that get spread or iterated. Simple singletons are always safer.

### Time to Diagnose
~1 hour.

---

## 8. OAuthAccountNotLinked error

### Symptom
Google sign-in returned `OAuthAccountNotLinked` error page. User couldn't sign in.

### Root Cause
A seed script created a User record with an email but no corresponding Account record. When Google OAuth tried to sign in with that email, NextAuth found the existing User but no linked Account, and refused to auto-link for security.

### Fix
Deleted the unlinked user, let OAuth create a fresh User + Account pair.

### Prevention
Seed scripts that create users must also create the corresponding Account record, or don't seed users at all — let OAuth handle user creation.

### Time to Diagnose
~30 minutes.

---

## 9. Tailwind v4 build — unknown utility classes

### Symptom
`Cannot apply unknown utility class 'bg-brand-100'` during build. Custom color tokens not recognized.

### Root Cause
Tailwind v4 with `@tailwindcss/postcss` requires explicit config loading. The custom theme tokens defined in `tailwind.config.ts` weren't being picked up.

### Fix
Add to `globals.css`:
```css
@config "../../tailwind.config.ts";
```

### Prevention
When using Tailwind v4 with custom themes, always add the `@config` directive in the CSS entry point.

### Time to Diagnose
~15 minutes.

---

## 10. Favicon not showing — PNG renamed to .ico

### Symptom
No favicon in browser tab. No errors in console.

### Root Cause
Two issues stacked:
1. Generated a PNG file but named it `favicon.ico`. Browsers expect `.ico` format or correct MIME type.
2. Placed `icon.png` in `src/app/` which Next.js treated as an App Router route (500 error).

### Fix
Place `icon.png` in `public/` (static serving) and explicitly add to metadata:
```typescript
icons: {
  icon: [{ url: "/icon.png", sizes: "48x48", type: "image/png" }],
}
```

### Prevention
- Favicons go in `public/`, not `src/app/`
- Use actual PNG files with `.png` extension, not renamed `.ico`
- Always test favicon in incognito (aggressive caching)

### Time to Diagnose
~45 minutes across 3 attempts.
