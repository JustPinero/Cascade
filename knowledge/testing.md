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
