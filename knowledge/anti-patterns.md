# Anti-Patterns

Category: anti-patterns
Source: deployment-playbook (103 lessons = 103 mistakes made once)

## From Deployment Playbook

### Environment Variables
- [LESSON] NEVER put secrets in VITE_, NEXT_PUBLIC_, or EXPO_PUBLIC_ prefixed vars
- [LESSON] Don't use `echo` for Vercel env vars — trailing newlines break OAuth
- [LESSON] Don't assume .env.local works on all platforms — validate at startup

### Docker
- [LESSON] Don't use multi-stage Docker builds with pnpm — symlinks break
- [LESSON] Don't forget .npmrc in Docker COPY — pnpm config is required
- [LESSON] Don't install CLI tools as devDependencies in Docker — they get pruned

### Authentication
- [LESSON] Don't hardcode localhost in OAuth callbacks — use env vars
- [LESSON] Don't ship broken OAuth buttons — App Store will reject
- [LESSON] Don't store tokens in localStorage — use httpOnly cookies

### Real-Time
- [LESSON] Don't assume CORS "just works" for WebSockets — must configure explicitly
- [LESSON] Don't send full state on every WebSocket tick — diff and send changes only
- [LESSON] Don't ignore JWT expiry on long-lived connections — add refresh listeners

### Build Systems
- [LESSON] Don't run `migrate deploy` on empty database — use `db push` first
- [LESSON] Don't forget `prisma generate` in the build pipeline — TypeScript will fail
- [LESSON] Don't assume Railway detects monorepo start commands — configure explicitly

See `knowledge/deployment-playbook/DEPLOYMENT-PLAYBOOK.md` for the full top-15 mistakes list.
