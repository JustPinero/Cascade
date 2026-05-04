import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Phase 23.8 — local dev uses `pnpm dev` (1Password resolves
    // secrets); CI uses `dev:ci` which skips `op run` since 1Password
    // CLI isn't available in GitHub Actions runners. The existing
    // smoke specs don't exercise Anthropic call paths, so a fake key
    // is enough to satisfy startup validation.
    command: process.env.CI ? "pnpm dev:ci" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: process.env.CI
      ? {
          ANTHROPIC_API_KEY: "sk-ant-ci-fake-key-not-used-by-smoke-specs",
          DATABASE_URL: "file:./test-e2e.db",
        }
      : undefined,
    timeout: 120_000,
  },
});
