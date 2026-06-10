# Environment Variables

## Required
| Variable | Purpose | Where Used |
|----------|---------|------------|
| ANTHROPIC_API_KEY | Powers every Anthropic API call (Overseer chat, wizard, briefing, feature-check, feature-proposer, retroactive-harvester) | Server-side only |
| DATABASE_URL | SQLite database connection | `prisma.config.ts` + `lib/db.ts` (defaults to `file:./dev.db`) |

## Optional integrations
| Variable | Purpose | Where Used |
|----------|---------|------------|
| VERCEL_TOKEN | Poll Vercel deployment status | `lib/deploy-monitor.ts` → `/api/integrations/deploy-status` |
| RAILWAY_TOKEN | Poll Railway deployment status | same |
| ANTHROPIC_FEATURE_SOURCES | Comma-separated URL list for the upstream feature-check fetch path (overrides the default Anthropic docs feed) | `lib/anthropic-feature-check.ts` |

## Configuration (not secrets)
| Variable | Default | Purpose |
|----------|---------|---------|
| PROJECTS_DIR | `~/projects` | Root directory the scanner walks. Absolute or `~`-prefixed |
| CASCADE_KNOWLEDGE_DIR | `./knowledge` | Path to the knowledge directory (lessons + advisories) |
| CASCADE_PORT | `3000` | Port the dev server binds. Threaded into `scripts/install-hooks.ts` so generated Stop hooks ping the right webhook |
| CASCADE_MAX_CONCURRENT_SUBAGENTS | `3` | Concurrency cap for the dispatch queue. Tuned per host RAM (Phase 22 — leave room for the lead Claude + N teammates) |
| NODE_OPTIONS | unset | Phase 26 — on this Windows box set to `--use-system-ca` so Node trusts the local TLS-intercepting root CA. Required for `fetch("https://api.anthropic.com/...")` to succeed on networks that do SSL inspection |

## Runtime-set (not user-configured)
| Variable | Set by | Purpose |
|----------|--------|---------|
| CASCADE_DISPATCH_ID | Cascade dispatcher (Phase 23.2), via `launchInTerminal` / `launchInWtBatch` extraEnv | Equal to `Dispatch.idempotencyKey`. The spawned Claude Code session reads it and the Stop hook posts it back to `/api/webhook/session-complete` for deterministic idempotency |
| NODE_ENV | Next.js / Vitest | Standard — `"development"`, `"production"`, or `"test"`. Used to gate dev-only side effects (e.g. engineer-channel writeback logs) |
| CI | CI runner | Standard. Skips interactive paths in test/setup scripts |

## Notes
- `ANTHROPIC_API_KEY` must NEVER reach client-side code.
- `DATABASE_URL` points to a local SQLite file — no network access needed.
- `PROJECTS_DIR` should be an absolute path or `~` prefixed.
- All env vars live in `.env` (loaded by `op run --env-file=.env -- next dev`), which is gitignored. Secret references use `op://Cascade/...` resolved by the 1Password CLI; non-secret values are plain strings.
