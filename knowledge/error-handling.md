# Error Handling Lessons

Category: error-handling
Source: deployment-playbook + project audits

## From Deployment Playbook

### Production Error Patterns
- [LESSON] Claude API JSON parse failures: strip markdown code fences before parsing, retry on failure
- [LESSON] localStorage.setItem throws in Safari private browsing — always wrap in try-catch
- [LESSON] Graceful shutdown: handle SIGTERM/SIGINT with force-exit timeout (Railway sends SIGTERM)
- [LESSON] Health checks must return 200 even during DB initialization — Railway kills on 503
- [LESSON] expo-notifications crashes in Expo Go — wrap in try-catch with platform check

### Validation Patterns
- [LESSON] Zod env validation at startup: fail fast with clear messages, not cryptic runtime errors
- [LESSON] LLM response parsing: defensive JSON extraction with retry logic and timeout via AbortController

### Silent Failures
- [LESSON] Socket.io CORS mismatch fails silently — add client-side error event logging
- [LESSON] Vite dev proxy masks CORS issues until production — test with production-like config
- [LESSON] @supabase/ssr throws at import time without env vars — guard imports

See `knowledge/deployment-playbook/guides/llm-api-integration.md` for full LLM error handling guide.
