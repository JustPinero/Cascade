# Pre-Deploy Checklist: Vite + Vercel (SPA)

## vercel.json
- [ ] SPA rewrite rule: `{ "source": "/(.*)", "destination": "/index.html" }`
- [ ] Security headers: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
- [ ] CSP includes auth provider domains (Clerk: `*.clerk.accounts.dev`, `api.clerk.com`)
- [ ] If monorepo: `vercel.json` at repo root (not in app subdirectory)

## Environment Variables
- [ ] No secrets in `VITE_*` variables (API keys, tokens, secrets)
- [ ] API keys proxied through Vercel Serverless Functions
- [ ] All `VITE_*` vars set in Vercel for Production, Preview, AND Development
- [ ] `.env.example` committed with all required variable names
- [ ] Runtime check at app init: `if (!import.meta.env.VITE_KEY) throw new Error(...)`
- [ ] Dev proxy in `vite.config.ts` matches production serverless routes

## Build
- [ ] `npm run build` succeeds locally (`tsc -b && vite build`)
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Bundle size warning addressed (dynamic imports for large libraries)
- [ ] Serverless functions use query params (not path params) for IDs

## Auth (if using Clerk)
- [ ] `routing="hash"` on `<SignIn>` component
- [ ] CSP includes `connect-src` AND `frame-src` for Clerk domains
- [ ] Test auth flow in preview deployment (CSP doesn't apply to localhost)

## Assets
- [ ] Favicon in `public/`
- [ ] All static assets in `public/` or imported in code

## Post-Deploy
- [ ] Navigate directly to a nested route (test SPA rewrite)
- [ ] Test auth flow end-to-end
- [ ] Check browser console for CSP violations
- [ ] Verify API proxy endpoints work (not just frontend)
