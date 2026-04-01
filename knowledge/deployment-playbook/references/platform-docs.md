# Platform Documentation Reference

> Don't copy platform docs into this repo — they go stale.
> Instead, know **where to look** and **what matters** at each URL.
> Last verified: 2026-03-30

---

## Vercel

### Environment Variables
**URL:** https://vercel.com/docs/environment-variables
**What matters for you:**
- How `NEXT_PUBLIC_` / `VITE_` prefixes work (build-time inlining)
- Difference between Production, Preview, and Development environments
- `vercel env pull` behavior (overwrites .env.local — PointPartner #8)
**Related lessons:** RatRacer #1, PointPartner #1, #8, DocDoc #2, #5, MonsterMash #1

### Serverless Functions API
**URL:** https://vercel.com/docs/functions/functions-api-reference
**What matters for you:**
- File-based routing: `api/tmdb/movie.ts` → `/api/tmdb/movie`
- Query params vs path params (`[id].ts` bracket notation)
- Request/response types (`VercelRequest`, `VercelResponse`)
**Related lessons:** MonsterMash #2, #3

### Monorepo Configuration
**URL:** https://vercel.com/docs/monorepos
**What matters for you:**
- Root directory setting vs `vercel.json` placement
- `installCommand` / `buildCommand` override patterns
- Turbo integration and `--filter` syntax with `...` suffix
**Related lessons:** Site-Unseen #1, PointPartner #7, medipal #11, ARC #8

### vercel.json Reference
**URL:** https://vercel.com/docs/project-configuration
**What matters for you:**
- `rewrites` for SPA routing (every SPA needs this)
- `headers` for security (CSP, X-Frame-Options)
- `buildCommand` / `outputDirectory` for monorepos
**Related lessons:** DocDoc #3, #6, MonsterMash #3

### Function Limits
**URL:** https://vercel.com/docs/functions/limitations
**What matters for you:**
- Execution timeout (10s free, 60s pro, 300s enterprise)
- Memory limits
- Payload size limits
- Cold start behavior
**Related lessons:** General awareness — check before deploying AI proxy functions

---

## Railway

### Config-as-Code (railway.toml)
**URL:** https://docs.railway.com/config-as-code/reference
**What matters for you:**
- `[build]` section: builder type, Dockerfile path
- `[deploy]` section: healthcheckPath, healthcheckTimeout, restartPolicy
- Start command configuration
**Related lessons:** medipal #4, #7, HR Hero #2, ARC #6

### Health Checks
**URL:** https://docs.railway.com/deployments/healthchecks
**What matters for you:**
- How Railway determines healthy vs unhealthy (HTTP status code)
- What happens when health check fails (container killed + restarted)
- Timeout configuration and retry behavior
- **Critical:** returning 503 during DB init kills the deploy
**Related lessons:** medipal #4, ARC #6

### Nixpacks
**URL:** https://nixpacks.com/docs
- Getting started: https://nixpacks.com/docs/getting-started
- Configuration: https://nixpacks.com/docs/configuration/file
- Node.js provider: https://nixpacks.com/docs/providers/node
**What matters for you:**
- How it detects start commands (reads root package.json)
- How it handles monorepos (doesn't understand workspaces by default)
- Custom install/build/start commands in railway.toml
**Related lessons:** HR Hero #2, PointPartner #11

### Docker on Railway
**URL:** https://docs.railway.com/builds/dockerfiles
**What matters for you:**
- BuildKit is the default (no shell redirects in COPY)
- How Railway passes env vars to Docker builds
- Health check configuration with Docker
**Related lessons:** medipal #1, #2, #3, ARC #1, #5, #7

### Networking
- Public: https://docs.railway.com/networking/public-networking
- Private: https://docs.railway.com/networking/private-networking
- TCP proxy: https://docs.railway.com/networking/tcp-proxy
**What matters for you:**
- Railway uses a reverse proxy (must set `trust proxy`)
- How `PORT` env var is injected
- Private networking between services (database URLs)
**Related lessons:** Site-Unseen #3

---

## Supabase

### Connection Pooling
**URL:** https://supabase.com/docs/guides/database/connecting-to-postgres
**What matters for you:**
- Transaction pooler (port 6543) vs Session pooler vs Direct (port 5432)
- IPv4 (`aws-1-` prefix) vs IPv6 (`aws-0-` prefix) — Vercel needs IPv4
- `?pgbouncer=true` parameter requirement
- `DIRECT_URL` for Prisma migrations (bypasses pooler)
**Related lessons:** RatRacer #2, medipal (Prisma connection)

### Row Level Security
**URL:** https://supabase.com/docs/guides/database/postgres/row-level-security
**What matters for you:**
- Cross-table policy recursion (infinite hang, no error)
- `SECURITY DEFINER` functions to break circular dependencies
- Storage `owner_id` auto-management (don't parse from paths)
**Related lessons:** E1C #6, #7

### Edge Functions
- Overview: https://supabase.com/docs/guides/functions
- Deploy: https://supabase.com/docs/guides/functions/deploy
**What matters for you:**
- Deno runtime (not Node.js)
- Environment variables via `Deno.env.get()`
- Service role key access (server-side only)
- Auth pattern: verify caller JWT → use service role for privileged ops
**Related lessons:** E1C (Edge Function patterns)

### Auth
- Overview: https://supabase.com/docs/guides/auth
- Sessions: https://supabase.com/docs/guides/auth/sessions
**What matters for you:**
- `autoRefreshToken` and `persistSession` configuration
- Mobile requires AsyncStorage adapter for session persistence
- `detectSessionInUrl: false` for mobile apps
**Related lessons:** E1C (auth provider patterns)

### Database Migrations
**URL:** https://supabase.com/docs/guides/deployment/managing-environments
**What matters for you:**
- `supabase migration list` to verify applied migrations
- `supabase db push` for first-time schema sync
- Local vs remote environments
- **Free tier pauses after 1 week inactivity** — upgrade before production
**Related lessons:** E1C #9

---

## Expo / EAS

### eas.json Reference
**URL:** https://docs.expo.dev/eas/json/
**What matters for you:**
- Build profiles: development, preview, production
- `autoIncrement` for version management
- `distribution` types (internal, store)
- iOS resourceClass for faster builds
**Related lessons:** E1C, GYLR2 (EAS configuration)

### Environment Variables in EAS
**URL:** https://docs.expo.dev/eas/environment-variables/
**What matters for you:**
- `EXPO_PUBLIC_*` is compiled into app binary (visible to users)
- `eas secret:create` for production secrets
- How env vars are injected at build time vs runtime
**Related lessons:** GYLR2 #1, E1C

### App Store Submission
**URL:** https://docs.expo.dev/submit/introduction/
**What matters for you:**
- iOS: Apple Developer enrollment, App Store Connect setup
- Android: Google Play Console, service account key
- `eas submit` commands for both platforms
- Required metadata: screenshots, privacy policy, icons
**Related lessons:** E1C #1, #3

### EAS Update (OTA)
- Introduction: https://docs.expo.dev/eas-update/introduction/
- Runtime versions: https://docs.expo.dev/eas-update/runtime-versions/
**What matters for you:**
- JS-only changes can ship without app store review
- Runtime version policy determines update compatibility
- Channels isolate updates per build profile
**Related lessons:** General awareness

### Config Plugins
- Plugins: https://docs.expo.dev/config-plugins/introduction/
- App config: https://docs.expo.dev/versions/latest/config/app/
- Configuration: https://docs.expo.dev/workflow/configuration/
**What matters for you:**
- `app.config.js` for dynamic configuration (env var injection)
- URL scheme generation for OAuth redirect URIs
- `supportsTablet` setting
- `expo-doctor` validation
**Related lessons:** E1C #2, GYLR2 #2

---

## Prisma

### Connection Poolers (PgBouncer / Supabase)
**URL:** https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer
**What matters for you:**
- `?pgbouncer=true` in connection string
- `directUrl` for migrations (schema changes can't go through pooler)
- Connection limit configuration
**Related lessons:** RatRacer #2

### Production Deployment
**URL:** https://www.prisma.io/docs/orm/prisma-client/deployment/deploy-prisma
**What matters for you:**
- `prisma generate` must run before application code
- `postinstall` script pattern
- Serverless deployment considerations
**Related lessons:** RatRacer #3, medipal #3, HR Hero #3, ARC #3

### Prisma Generate CLI
**URL:** https://www.prisma.io/docs/cli/generate
**What matters for you:**
- When to run generate (after schema changes, in CI, in Docker)
- Output location and caching behavior
- Monorepo: run from the package that owns the schema
**Related lessons:** ARC #5

---

## Express.js

### Production Security
**URL:** https://expressjs.com/en/advanced/best-practice-security.html
**What matters for you:**
- Helmet.js configuration
- Rate limiting patterns
- Input validation

### Production Performance
**URL:** https://expressjs.com/en/advanced/best-practice-performance.html
**What matters for you:**
- Compression, caching, logging
- Process management

### Behind Proxies
**URL:** https://expressjs.com/en/guide/behind-proxies.html
**What matters for you:**
- `trust proxy` setting (1 = trust single hop)
- How `req.ip` is determined
- **Critical:** without this, rate limiting breaks behind Railway/Vercel
**Related lessons:** Site-Unseen #3

---

## Socket.io

### CORS Configuration
**URL:** https://socket.io/docs/v4/handling-cors/
**What matters for you:**
- CORS must be configured separately from Express
- Origins must exactly match (no trailing slash, correct protocol)
- Silent failure on mismatch — no browser error
**Related lessons:** Site-Unseen #4, medipal #13, ARC #8

### Multi-Node Deployment
**URL:** https://socket.io/docs/v4/using-multiple-nodes/
**What matters for you:**
- Sticky sessions or Redis adapter required for multi-instance
- In-memory state (active connections, rooms) is per-instance
- Scaling considerations for real-time apps
**Related lessons:** Site-Unseen #7 (race conditions)

---

## When to Check These Docs

- **Starting a new project:** Check limits and pricing pages for your chosen platforms
- **Before first deploy:** Check connection string format, health check behavior, env var injection
- **When something breaks:** Check the specific platform doc related to the symptom (use the symptom→fix table in DEPLOYMENT-PLAYBOOK.md first)
- **Before upgrading:** Check migration guides for breaking changes (Prisma, Expo SDK, Next.js)
- **Quarterly:** Skim changelog/blog for your platforms — new features can simplify existing patterns
