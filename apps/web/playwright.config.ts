import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
