import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules", ".next", "e2e"],
    // Phase 23.7 — push schema to a template DB once per test run.
    // Rigs copy this template instead of re-pushing per-test, which
    // serializes the Prisma client regen and prevents flaky races
    // across parallel test workers.
    globalSetup: ["./tests/harness/global-setup.ts"],
    // Phase 42 (P0.1) — the webhook-ingest containment guard refuses
    // projectPaths outside PROJECTS_DIR. Tests use "/p/..." fake paths
    // by convention, so the suite runs with /p as the managed root.
    // Files needing a different root set process.env themselves.
    env: {
      PROJECTS_DIR: "/p",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
    },
  },
});
