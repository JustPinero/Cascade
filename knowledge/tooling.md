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
