import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;

/**
 * Exercises live-mode behavior — the graph actually talking to a running
 * backend. Requires apps/api's server AND a seeded Postgres database to
 * be running locally first (see docs/DEVELOPMENT_STATUS.md), with
 * apps/web/.env.local pointing at them. Unlike playwright.config.ts, this
 * does NOT clear the backend env vars — it inherits .env.local as-is.
 *
 * Run with: npm run test:e2e:live --workspace apps/web
 */
export default defineConfig({
  testDir: "./e2e-live",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
