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

## From 2026-04 work

### Best-effort persistence
- [LESSON] When a generation step (Claude, ffmpeg, etc.) succeeds and a downstream persistence step might fail, isolate the persistence in try/catch — the user already saw the rendered output and shouldn't lose it because of a DB write hiccup. Surface the persistence failure on the result object (e.g. `proposalId: null`) instead of throwing.
- [LESSON] Spawn-as-child-process to isolate non-zero exit codes from sub-CLIs. When `pingthings install` started auto-spawning `pingthings normalize`, the install command inherited normalize's `process.exit(1)` on bad audio fixtures. Fix: `spawnSync('node', [cli, 'normalize', pack])` — the child's exit doesn't propagate. Importing the module directly does.

### Cross-process coordination via sentinel files
- [LESSON] In-process state can't coordinate across parallel CLI invocations. When `pingthings play` was firing N times in lockstep from N tmux panes, an in-process debounce did nothing — each invocation was a fresh process with empty memory. Fix: write a Unix-ms timestamp to a known sentinel file (`~/.config/pingthings/.last-play-time`), check it on every invocation, drop if recent. The FIFO race resolves naturally on whoever stamps first.

### Validate.sh-time bugs sometimes hide in test fixtures
- [LESSON] If validate.sh starts failing on a test that was passing yesterday, check for invalid test FIXTURES before assuming the new code is wrong. The pingthings install test ships a `beep.wav` stub that ffmpeg correctly errors on; that error was correctly captured but I was inheriting the exit code into the parent install command. Fix was in the parent (spawn vs import), not the test.
