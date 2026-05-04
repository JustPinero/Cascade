# Tooling Lessons

Category: tooling
Source: deployment-playbook + project audits

## From Deployment Playbook

### CLI Tools
- [LESSON] Railway CLI: `railway login` requires separate terminal tab (not inline)
- [LESSON] Railway CLI: account tokens (CI) vs project tokens (scoped) — critical difference
- [LESSON] `vercel link` overwrites .env.local — back up before linking
- [LESSON] pnpm: npm to pnpm migration requires deleting package-lock.json

### Build Tools
- [LESSON] Next.js 16 Turbopack breaks webpack-dependent plugins — use --webpack flag
- [LESSON] next-pwa v10 removed skipWaiting option — check changelogs before upgrading
- [LESSON] Turborepo filter syntax: `--filter=app...` (trailing dots include deps)
- [LESSON] NIXPACKS: monorepo requires explicit cd between directory commands

### Docker
See `knowledge/deployment-playbook/guides/docker-pnpm-monorepo.md` for full guide.
- [LESSON] pnpm + Docker: single-stage builds recommended (symlinks break in multi-stage)
- [LESSON] Dockerfile COPY doesn't support shell redirects — use RUN mkdir
- [LESSON] Install CLI tools globally in Docker (npm install -g) — devDeps get pruned

### Platform Configuration
See `knowledge/deployment-playbook/checklists/` for platform-specific pre-deploy checklists.
- [LESSON] vercel.json must live at repo root for monorepo deployments
- [LESSON] Railway healthcheck timeout: set to 120s for apps with DB initialization
- [LESSON] Expo: use `npx expo install` only — npm/yarn install causes version conflicts

## From 2026-04 work

### 1Password runtime secrets (op run)
- [LESSON] `op run --env-file=.env -- next dev` reads `.env` (with `op://` references), NOT `.env.local`. After switching a project to op-run, copy `.env.example` to `.env` and replace literal secrets with `op://Vault/Item/field` references — leaving secrets in `.env.local` will look like it works but `op run` won't substitute them.
- [LESSON] After a Cascade pull that introduces `op run`, `pnpm dev` fails until `.env` exists. Add a one-line check at the top of validate.sh / dev script: `[ -f .env ] || (cp .env.example .env && echo "Created .env — fill in op:// refs before running dev")`.

### Audio-pack hygiene (pingthings)
- [LESSON] Run `pingthings normalize <pack>` (ffmpeg loudnorm I=-23 LUFS, TP=-2 dB) before shipping any new sound pack — raw OST rips vary by 20+ LU and make the global volume slider useless. Normalized packs feel consistent at the same `volume` setting.
- [LESSON] Process-name allowlist beats heuristic detection for "is the user on a video call?" Per-OS allowlist (`zoom.us`, `Microsoft Teams`, `Discord`, `FaceTime` on darwin; `zoom`, `teams`, `discord` on linux; `Zoom.exe`, `ms-teams.exe` on win32) is short, reliable, and easy to extend. Heuristic detection (audio device in use, microphone active) had too many false positives.

### Webhook / on-demand server pattern for CLI tools
- [LESSON] On-demand local HTTP server pattern (`pingthings serve`): bind to `127.0.0.1` by default, optional `--token` query param, no daemon. Lifecycle is the user's terminal. Beats running a long-lived background daemon for tools that only need to receive sporadic webhooks during a coding session.
- [LESSON] On-demand servers > daemons for dev-tooling: a daemon you forgot to start is a daemon that doesn't help. A `serve` subcommand with copy-pasteable curl examples in `--help` is discoverable and stops cleanly when the terminal closes.

### Repo / tool structure for shareable methodology
- [LESSON] Three-bucket layout for shareable prompts/templates: `universal/` (project-agnostic), `cascade-derived/` (came from Cascade, may still reference it), `project-specific/`. The boundary between universal and cascade-derived is "would a stranger with no Cascade context find this useful?" — be ruthless; misfiling cascade-flavored content as universal pollutes the bucket and forces future cleanup.
- [LESSON] Stack-specific overlays > combinatorial template variants. Instead of `web-app-go.md`, `web-app-rust.md`, `web-app-python.md`, ship one `web-app.md` plus thin `overlays/ci-go.md`, `overlays/ci-rust.md`. Overlays compose; variants don't, and they age into N-way drift.
