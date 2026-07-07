# Security Guidance — Cascade

Local-first Next.js dashboard that dispatches Claude Code sessions, shells out to CLIs, and receives webhooks. The dominant risks are command injection, secret leakage, and unvalidated external input — not classic multi-tenant web risks.

## Critical paths (recommend /ultrareview at phase-complete)
- `app/api/webhook/**` — external input surface (Stop-hook pings from Claude sessions)
- `lib/claude-dispatcher.ts` — builds and executes shell commands that launch Claude sessions
- `prisma/migrations` / `prisma/schema.prisma` — schema changes hit the live `./dev.db`

## Secrets
- `ANTHROPIC_API_KEY` is server-side only. All Anthropic calls go through API routes; never expose the key to client code or response bodies.
- Secrets come from 1Password (`op`) / `.env.local`. Never commit `.env*`; keep `.env.example` with placeholders only.
- Never hardcode `sk-ant-*` keys, `op://` references, or private keys anywhere in `app/` or `lib/`.

## Shell execution (dispatcher, gh, op)
- Never pass user- or webhook-derived input directly into shell command strings. Use argument arrays or escape properly.
- Use promisified `exec` with timeout handling; always handle stderr.
- `gh` and `op` are assumed pre-authenticated on the developer machine — do not prompt for or store credentials.

## Webhooks & external input
- `app/api/webhook/session-complete` accepts unauthenticated local pings: validate payload shape (project slug, session id) before any DB write or filesystem access.
- Project `path` fields are absolute filesystem paths — build derived paths with `path.join`/`path.resolve`, never string concatenation, and never let webhook input redirect reads/writes outside known project roots.

## Server/client boundary
- Prisma, `fs`, and `child_process` only in server components and API routes. Any file with `"use client"` must not import them.

## Database
- The live DB is `./dev.db` at the project root. Never delete or reset it; use `prisma db push` (not `migrate`) to sync schema.
- SQLite JSON is stored as String — validate/parse defensively; malformed JSON from a webhook must not crash health/progress engines.
