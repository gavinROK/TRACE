import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // 5 concurrent Chromium instances (Playwright's CPU-core-based default)
  // reliably starved some tests of enough time to settle under this
  // sandboxed environment's CPU constraints — confirmed by running
  // --workers=1 and getting 100% reliable passes. 2 is a middle ground
  // between that and full parallelism.
  workers: 2,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // Always starts fresh (never reuses a server someone else left
    // running) and explicitly clears the backend env vars, so this suite
    // deterministically exercises demo mode regardless of whatever
    // .env.local happens to contain on a given machine. Live-mode
    // behavior has its own suite — see playwright.live.config.ts.
    reuseExistingServer: false,
    env: { TRACE_API_BASE_URL: "", TRACE_API_KEY: "" },
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
