---
paths:
  - "app/api/**"
---
# API Route Rules (Next.js 16 App Router)

- Route handlers export named HTTP method functions (`GET`, `POST`, ...) — never default exports.
- Prisma queries are allowed here (and in server components) — never in client components.
- `ANTHROPIC_API_KEY` and all secrets stay server-side. Never return them in a response body or pass them to client code.
- Anthropic API calls: use streaming (`ReadableStream` + proper `Response` objects) for long responses; handle 429 with exponential backoff.
- Dynamic route `params` is a Promise in Next.js 15+ — `await` it.
- Shell-outs (`gh`, `op`, dispatching Claude sessions): use promisified `exec`, handle stderr, never interpolate user input into command strings — use argument arrays or escape.
- All async operations awaited — no floating promises.
- Webhook endpoints (`app/api/webhook/**`) receive external input: validate payload shape before touching the DB or filesystem.
