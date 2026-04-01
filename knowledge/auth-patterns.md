# Auth Patterns

Category: auth
Source: deployment-playbook (10 OAuth/auth lessons)

## From Deployment Playbook

### OAuth Deployment Gotchas
- [LESSON] Vercel env vars with trailing newlines break OAuth callbacks — use `printf` not `echo`
- [LESSON] NextAuth custom middleware required for database sessions (default only works with JWT)
- [LESSON] HTTPS cookie name prefix: `__Secure-` in production vs `next-auth.session-token` in dev
- [LESSON] OAuthAccountNotLinked: seed existing users with provider accounts to prevent error
- [LESSON] iOS OAuth requires reversed client ID domain notation (com.googleusercontent.apps.*)
- [LESSON] Token expiry: preemptive refresh with 5-minute buffer, not on-error retry

### API Key Security
- [LESSON] Never expose API keys via VITE_, NEXT_PUBLIC_, or EXPO_PUBLIC_ prefixes
- [LESSON] Implement server-side proxy for third-party API calls (Claude, TMDB, etc.)
- [LESSON] Client-side rate limiting prevents cost overruns on AI API calls

### Mobile Auth (Expo/EAS)
- [LESSON] Apple Sign-In: different OAuth config per platform (web vs iOS)
- [LESSON] Broken OAuth buttons cause App Store rejection — remove incomplete auth methods
