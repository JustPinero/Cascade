# PointPartner — Deployment Lessons

Extracted from the initial build and deploy session (2026-03-30).

---

## 1. Next.js NEXT_PUBLIC_ env vars not available at build time via shell export

### Symptom
Build failed with `Missing Supabase environment variables` error even though `NEXT_PUBLIC_SUPABASE_URL` was set via inline shell variables in the npm script:
```
"build:web": "NEXT_PUBLIC_SUPABASE_URL=... npm run build --workspace=web"
```

### Root Cause
`NEXT_PUBLIC_` env vars are inlined by webpack/Next.js at **compile time**. Setting them as shell variables in an npm script doesn't propagate them into the Next.js build process — npm runs scripts in a subshell that doesn't inherit inline env vars to child processes. The `export` approach also failed because the webpack process was already started.

### Fix
Created a `web/.env` file (committed to git) with placeholder values:
```
NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...placeholder
```
Real values override via `.env.local` (gitignored). Next.js loads `.env` as baseline, `.env.local` takes precedence.

### Prevention
- **Always create a `web/.env` with placeholder `NEXT_PUBLIC_` values** for any project using Supabase/Firebase/etc. with Next.js
- Add to the kickoff template's Phase 1 foundation checklist
- Document in `references/env-vars.md` which vars need build-time defaults

### Stack
Next.js 16, npm workspaces, Supabase Auth (@supabase/ssr)

### Time to Diagnose
~15 minutes across multiple build attempts

---

## 2. @supabase/ssr throws at import time if env vars are missing

### Symptom
Build error during static page prerendering:
```
Error: @supabase/ssr: Your project's URL and API key are required to create a Supabase client!
```
Even though the pages were `'use client'` components, the build process still tried to evaluate them.

### Root Cause
`@supabase/ssr` validates the Supabase URL and anon key at the point where `createBrowserClient()` or `createServerClient()` is called. During Next.js build, client components get SSR-prerendered, which invokes the Supabase client constructor. With no env vars, it throws.

### Fix
Two-part fix:
1. `web/.env` with placeholder values (see issue #1)
2. Server components that use Supabase marked with `export const dynamic = 'force-dynamic'` to prevent prerendering

### Prevention
- Any page calling Supabase server client needs `dynamic = 'force-dynamic'`
- Provide placeholder env vars for build (`.env` file approach)
- Consider wrapping client creation in a lazy function that only runs at request time

### Stack
Next.js 16, @supabase/ssr 0.9.0, Supabase Auth

### Time to Diagnose
~10 minutes

---

## 3. Next.js 16 defaults to Turbopack — breaks webpack-dependent plugins

### Symptom
Build crashes with `Call retries were exceeded` error when `@ducanh2912/next-pwa` plugin is configured:
```
Error: Call retries were exceeded
```

### Root Cause
Next.js 16 defaults to Turbopack for builds. `@ducanh2912/next-pwa` wraps the webpack config, which is incompatible with Turbopack. The plugin silently fails to configure, and the build crashes.

### Fix
Added `--webpack` flag to the web build command:
```json
"build": "next build --webpack"
```

### Prevention
- **Check plugin compatibility with Turbopack** before adding any Next.js plugin that modifies webpack config
- For PWA: consider `@serwist/next` which has better Next.js 15+ support
- Always test `next build` after adding config-wrapping plugins

### Stack
Next.js 16.2.1, @ducanh2912/next-pwa 10.2.9, Turbopack

### Time to Diagnose
~5 minutes

---

## 4. next-pwa `skipWaiting` option removed in v10

### Symptom
TypeScript build error:
```
Type error: Object literal may only specify known properties, and 'skipWaiting' does not exist in type 'PluginOptions'.
```

### Root Cause
`@ducanh2912/next-pwa` v10 removed the `skipWaiting` config option. The Workbox config changed between versions.

### Fix
Removed `skipWaiting: true` from the PWA config.

### Prevention
- Check plugin changelogs before using config options from blog posts or older docs
- TypeScript catches this at build time — always build before committing plugin configs

### Stack
@ducanh2912/next-pwa 10.2.9

### Time to Diagnose
~2 minutes

---

## 5. JSDoc comment with `*/` inside terminates comment block

### Symptom
TypeScript compilation error with cryptic messages about expected expressions:
```
error TS1131: Property or signature expected.
error TS1109: Expression expected.
error TS1002: Unterminated string literal.
```

### Root Cause
A JSDoc comment contained a cron expression example with `*/`:
```typescript
/** Cron schedule expression (e.g., '*/30 * * * *' for every 30 min) */
```
The `*/` inside the string terminated the comment block early, causing the rest of the line to be parsed as code.

### Fix
Simplified the comment to remove the `*/` pattern:
```typescript
/** Cron schedule expression */
```

### Prevention
- Never put `*/` inside JSDoc comments, even in string examples
- Use `@example` blocks or inline `//` comments for cron expressions
- TypeScript catches this — always check build before committing

### Stack
TypeScript 5.8

### Time to Diagnose
~3 minutes

---

## 6. Supabase hand-written types don't match @supabase/supabase-js v2 type inference

### Symptom
TypeScript errors when using Supabase client methods:
```
Type error: Argument of type '{ user_id: string; card_id: string; }[]' is not assignable to parameter of type 'never'.
Type error: Spread types may only be created from object types.
Type error: Property 'id' does not exist on type 'never'.
```

### Root Cause
Hand-written `Database` types (created before `supabase gen types` could run) don't perfectly match the complex generic type inference that `@supabase/supabase-js` v2 expects. The client returns `never` for select/insert operations because the type structure doesn't satisfy the internal type constraints.

### Fix
Used type assertions on Supabase responses:
```typescript
const { data } = await supabase.from('programs').select('*');
const typedData = (data ?? []) as unknown as Tables<'programs'>[];
```
And for inserts:
```typescript
const { error } = await supabase.from('user_cards').insert(rows as never);
```

### Prevention
- **Always use `supabase gen types typescript` for production types** — hand-written types are a temporary measure
- Link the Supabase project early (Phase 1) so generated types are available from the start
- Add type generation to the build pipeline: `supabase gen types typescript > packages/shared/src/types/database.ts`

### Stack
@supabase/supabase-js 2.100.1, TypeScript 5.8

### Time to Diagnose
~10 minutes across multiple type errors

---

## 7. Vercel monorepo deployment — `cd ..` doesn't work in build commands

### Symptom
Vercel build fails:
```
npm error code ENOENT
npm error path /vercel/package.json
```

### Root Cause
When Vercel deploys a subdirectory (`web/`), it only uploads that directory's files. The `cd ..` in the build command goes to `/vercel/` which has no `package.json`. The parent monorepo root doesn't exist on the Vercel build machine.

### Fix
Deploy from the **project root** instead of the `web/` subdirectory. Created `vercel.json` at root:
```json
{
  "installCommand": "npm install",
  "buildCommand": "npm run build --workspace=packages/shared && cd web && next build --webpack",
  "outputDirectory": "web/.next",
  "framework": "nextjs"
}
```
Linked Vercel project from the root directory, not `web/`.

### Prevention
- **For monorepos: always deploy from root** with build commands that build dependencies first
- Set `outputDirectory` to the framework's output dir (e.g., `web/.next`)
- Don't use `rootDirectory` in Vercel for monorepos with shared packages — it excludes the shared code

### Stack
Next.js 16, Vercel, npm workspaces

### Time to Diagnose
~20 minutes (3 failed deployments)

---

## 8. Vercel `link` overwrites `.env.local` with project env vars

### Symptom
After running `vercel link`, the local `.env.local` was replaced with Vercel's project env vars (which were empty at the time), removing the Supabase credentials.

### Root Cause
`vercel link` downloads the project's environment variables and writes them to `.env.local`, overwriting any existing file.

### Fix
Re-wrote `.env.local` after linking. Set env vars in Vercel project first, then link.

### Prevention
- **Set Vercel env vars BEFORE running `vercel link`**
- Or: back up `.env.local` before linking, restore after
- Keep a `.env.local.backup` that's gitignored

### Stack
Vercel CLI 50.10.0

### Time to Diagnose
~3 minutes

---

## 9. Railway CLI rejects account tokens for most commands

### Symptom
```
Unauthorized. Please check that your RAILWAY_TOKEN is valid and has access to the resource you're trying to use.
```
Even though the same token worked via the GraphQL API (`{ me { name } }` returned successfully).

### Root Cause
Railway CLI commands like `link`, `up`, and `service` require a **project-scoped token**, not an account-level token. Account tokens work for the API but not the CLI.

### Fix
Created a project-scoped token via the GraphQL API:
```bash
curl -H "Authorization: Bearer $ACCOUNT_TOKEN" \
  -d '{"query":"mutation { projectTokenCreate(input: { projectId: \"...\", environmentId: \"...\", name: \"cli-deploy\" }) }"}' \
  https://backboard.railway.app/graphql/v2
```
Used the returned project token with `RAILWAY_TOKEN=... railway up -s workers`.

### Prevention
- **For Railway CLI: always use project tokens, not account tokens**
- Create project tokens via the API after creating the project with the account token
- Document which token type each CLI tool expects

### Stack
Railway CLI, Railway GraphQL API v2

### Time to Diagnose
~15 minutes

---

## 10. Railway `railway login` doesn't work in non-interactive terminals

### Symptom
```
Cannot login in non-interactive mode
```
Both `railway login` and `railway login -b` fail when run from Claude Code's shell.

### Root Cause
Railway CLI login requires an interactive TTY for the browser flow or pairing code display. Claude Code's shell environment is non-interactive.

### Fix
Bypassed CLI login entirely. Used account token via GraphQL API to create the project and services, then generated a project token for `railway up`.

### Prevention
- **For CI/CD and non-interactive environments: use API + project tokens**
- Don't depend on `railway login` in automated workflows
- Create tokens via the Railway dashboard or API

### Stack
Railway CLI

### Time to Diagnose
~10 minutes

---

## 11. Railway Railpack doesn't detect start command in monorepo

### Symptom
Build hangs with:
```
No start command detected. Specify a start command
```
Even though `workers/package.json` had a `start` script.

### Root Cause
Railway's Railpack builder reads the **root** `package.json` for the start command, not the workspace package. The root `package.json` had no `start` script. Environment variables `RAILWAY_START_COMMAND` and `RAILWAY_BUILD_COMMAND` are not read by Railpack.

### Fix
Created `railway.json` at the project root:
```json
{
  "build": {
    "buildCommand": "npm install && npm run build --workspace=packages/shared && npm run build --workspace=workers"
  },
  "deploy": {
    "startCommand": "node workers/dist/index.js"
  }
}
```

### Prevention
- **Always create `railway.json` for monorepo Railway deployments**
- Don't rely on `package.json` start scripts for non-root packages
- Test Railway builds locally with `railway up` before committing to CI

### Stack
Railway, Railpack 0.23.0, npm workspaces

### Time to Diagnose
~10 minutes (2 failed deployments)

---

## 12. PWA build artifacts (sw.js, fallback-*.js) committed to git

### Symptom
`git status` showed generated files like `web/public/sw.js`, `web/public/fallback-*.js` after building.

### Root Cause
`@ducanh2912/next-pwa` generates service worker files in `web/public/` during build. These are build artifacts but land in a directory that's typically committed.

### Fix
Added to `web/.gitignore`:
```
/public/sw.js
/public/sw.js.map
/public/workbox-*.js
/public/workbox-*.js.map
/public/swe-worker-*.js
/public/fallback-*.js
```

### Prevention
- **Add PWA build artifact patterns to `.gitignore` immediately** when installing a PWA plugin
- Check `git status` after first build with any new plugin

### Stack
@ducanh2912/next-pwa 10.2.9

### Time to Diagnose
~2 minutes

---

## 13. Root `.gitignore` pattern `.env` blocks committed `.env` files in subdirectories

### Symptom
`web/.env` (containing non-secret build-time placeholders) was being gitignored and couldn't be committed normally.

### Root Cause
Root `.gitignore` had a `.env` pattern which matches `.env` files in all subdirectories.

### Fix
Used `git add -f web/.env` to force-add the file. Also updated `web/.gitignore` to be specific:
```
.env.local
.env.production
.env.development
```
Instead of the broad `.env*` pattern.

### Prevention
- **Be specific in `.gitignore` patterns** — use `.env.local` instead of `.env*` or `.env`
- If you need a committed `.env` for build defaults, plan the gitignore patterns upfront

### Stack
Git

### Time to Diagnose
~5 minutes

---

# Summary

**Total issues found:** 13

**Top 3 most time-consuming to diagnose:**
1. **Vercel monorepo deployment** (~20 min, 3 failed deploys) — deploying from subdirectory vs root
2. **Railway CLI token types** (~15 min) — account vs project tokens
3. **NEXT_PUBLIC_ env vars at build time** (~15 min) — shell exports don't work

**Patterns identified:**
- **4 env var issues** (#1, #2, #8, #13) — env var behavior differences between local/build/production is the #1 source of deployment pain
- **3 monorepo issues** (#7, #11, #13) — monorepos add complexity to every deployment platform; each platform handles workspaces differently
- **2 Railway CLI issues** (#9, #10) — Railway CLI is limited in non-interactive environments; prefer API + project tokens
- **2 plugin compatibility issues** (#3, #4) — Next.js ecosystem plugins lag behind framework versions
