# Integrations Lessons

Category: integrations
Source: deployment-playbook (LLM, OAuth, real-time)

## From Deployment Playbook

### LLM API Integration
See `knowledge/deployment-playbook/guides/llm-api-integration.md` for full guide.
- [LESSON] Never expose API keys client-side — implement server-side proxy
- [LESSON] Defensive JSON parsing: strip code fences, retry logic, AbortController timeout
- [LESSON] Two-layer rate limiting: client-side (prevent cost) + server-side (prevent abuse)
- [LESSON] Cache LLM responses in database for repeated queries
- [LESSON] Claude API returns JSON wrapped in markdown code blocks — strip before parsing

### WebSocket/Socket.io
See `knowledge/deployment-playbook/guides/websocket-production.md` for full guide.
- [LESSON] CORS must match between Express and Socket.io configs (silent failure)
- [LESSON] JWT lifecycle: short-lived WS tokens with refresh listeners
- [LESSON] Tick diffing reduces WebSocket bandwidth 80-90%
- [LESSON] Set-based mutex prevents race conditions on concurrent events

### Platform APIs
- [LESSON] Railway CLI: account tokens vs project tokens — critical difference for CI/CD
- [LESSON] Supabase free tier auto-pauses — paid tier required for production
- [LESSON] Supabase RLS infinite recursion — use SECURITY DEFINER functions
