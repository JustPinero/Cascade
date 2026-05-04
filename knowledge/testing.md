# Testing Lessons

Category: testing
Source: deployment-playbook + project audits

## From Deployment Playbook

### Deployment Verification
- [LESSON] Smoke tests after deploy: hit health endpoint + key user flows
- [LESSON] CI tests for deployment config: validate vercel.json, railway.toml in pipeline
- [LESSON] E2E tests that block CI should use continue-on-error (prevent false deploy failures)

### Version Compatibility
- [LESSON] Vitest 4.x peer dep conflict with Vite 5 — use Vitest 2.x for Vite 5 projects
- [LESSON] Vite config `test` property needs `/// <reference types="vitest" />` triple-slash
- [LESSON] React 18 ref type incompatibility — use callback refs instead of createRef

### Test Patterns
- [LESSON] Fixture-based testing for external APIs (record responses, replay in tests)
- [LESSON] E2E manifest: track which flows are "passing", "failing", "not-started"
- [LESSON] pnpm test --run doesn't pass args correctly — use npx vitest run directly
- [LESSON] After every "added a new module" commit, run a one-line audit: `for f in src/new/*.js; do test -f test/$(basename $f .js).test.js || echo "$f → NO TEST"; done`. Caught the missing `normalize.test.js` after a large 1.6.0 ship.
- [LESSON] Cache slow detector shell-outs (system_profiler / pactl / powershell) with a TTL — without it the play hot-path adds 0.5–2s of latency on every multi-pane dispatch event. 60s TTL + a `force` flag on the detector function is the right shape.
- [LESSON] Test slash commands by mocking the *handler module* (not the route's response shape). Match the actual detection regex in your mock so command-name typos aren't masked: `mockIsCommand.mockImplementation((s) => /^\s*\/the-actual-command\b/i.test(s))`.
- [LESSON] HTTP server tests for on-demand CLIs (`pingthings serve`): spawn the actual CLI as a child process, wait for "listening on" stdout, fetch real endpoints, kill on cleanup. Don't unit-test the route handler in isolation — the server lifecycle is part of what you're testing.
