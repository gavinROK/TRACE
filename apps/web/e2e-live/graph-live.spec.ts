import { expect, test } from "@playwright/test";

/**
 * Requires a running, seeded backend (see playwright.live.config.ts).
 * Asserts against real database records, not fixed demo-mode ids — the
 * seeded data's shape (Acme Corp, 7 developers, synced mock repos) is
 * documented in apps/api/prisma/seed.ts and docs/DEVELOPMENT_STATUS.md.
 */
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("backend-status-badge")).toHaveAttribute("data-mode", "live", {
    timeout: 10_000,
  });
});

test("renders real organization data from the live backend", async ({ page }) => {
  await expect(page.getByTestId("backend-status-badge")).toContainText("Acme Corp");

  const orgNode = page.locator('[data-testid^="node-"]').filter({ hasText: "Acme Corp" });
  await expect(orgNode.first()).toBeVisible();
});

test("connects a GitHub installation and syncs it from the onboarding modal", async ({ page }) => {
  await page.getByRole("button", { name: "Connect GitHub" }).click();

  const modal = page.getByTestId("connect-github-modal");
  await expect(modal).toBeVisible();

  // A fresh id per run avoids any collision with manual testing or other
  // runs against the same database.
  await modal.getByLabel("Installation ID").fill(String(Date.now()).slice(-9));
  await modal.getByLabel("Account login").fill("e2e-live-test-org");
  await modal.getByRole("button", { name: "Connect & sync" }).click();

  // Real network round trip (connect, then sync, then a graph refetch) —
  // give it real time rather than asserting instantaneously.
  await expect(modal).not.toBeAttached({ timeout: 15_000 });

  // The mock GitHub client returns the same fixed repositories regardless
  // of which installation synced them, so this doesn't assert a specific
  // new count — only that the sync completed and the repository group
  // still renders correctly afterward (the refetch didn't break anything).
  const repoGroup = page.getByTestId("node-repository-group");
  await expect(repoGroup).toBeVisible();
  const repoNode = page.locator('[data-testid^="node-"]').filter({ hasText: "mock-" });
  await expect(repoNode.first()).toBeVisible();
});

test("shows the repositories group populated from a real GitHub sync", async ({ page }) => {
  const repoGroup = page.getByTestId("node-repository-group");
  await expect(repoGroup).toBeVisible();
  await expect(repoGroup).toContainText("Repositories");

  // Repository group — like departments — starts expanded by default
  // (only developer nodes start collapsed), so its children are already
  // visible without needing to click its toggle.
  // Seeded + synced data includes at least one repository from the mock
  // GitHub client (see apps/api/prisma/seed.ts / GithubSyncService).
  const repoNode = page.locator('[data-testid^="node-"]').filter({ hasText: "mock-" });
  await expect(repoNode.first()).toBeVisible();
});

test("opens the API usage dashboard and shows real provider data", async ({ page }) => {
  await page.getByTestId("node-api-usage-dashboard").click();

  const panel = page.getByTestId("api-usage-dashboard-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("By provider");
  // The seed/telemetry verification in this environment reported usage
  // under the "openai" provider — real data, not a fixture.
  await expect(panel).toContainText("openai", { timeout: 10_000 });

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).not.toBeAttached();
});

test("opens the security alerts panel, shows real alerts, and updates status", async ({
  page,
}) => {
  await page.getByTestId("node-security-alerts-group").click();

  const panel = page.getByTestId("security-alerts-panel");
  await expect(panel).toBeVisible();

  // Switch to "All" so this test doesn't depend on there being an OPEN
  // alert at the moment it runs (earlier sessions may have resolved it).
  await panel.getByRole("button", { name: "All", exact: true }).click();

  const alertCard = panel.locator('[data-testid^="security-alert-"]').first();
  await expect(alertCard).toBeVisible({ timeout: 10_000 });

  const select = alertCard.getByRole("combobox");
  const originalStatus = await select.inputValue();
  const nextStatus = originalStatus === "INVESTIGATING" ? "OPEN" : "INVESTIGATING";

  await select.selectOption(nextStatus);
  await expect(select).toHaveValue(nextStatus);

  // Restore the original status so this test is idempotent across runs.
  await select.selectOption(originalStatus);
  await expect(select).toHaveValue(originalStatus);
});

async function openAlertCount(page: import("@playwright/test").Page): Promise<number> {
  const text = await page.getByTestId("node-security-alerts-group").textContent();
  const match = text?.match(/(\d+) open alert/);
  if (!match) throw new Error(`Could not parse open-alert count from "${text}"`);
  return Number(match[1]);
}

test("resolving an open alert decrements the graph's open-alert count by exactly one", async ({
  page,
}) => {
  const countBefore = await openAlertCount(page);

  await page.getByTestId("node-security-alerts-group").click();
  const panel = page.getByTestId("security-alerts-panel");
  // Default filter is OPEN, so the first card here is guaranteed OPEN —
  // or there are none, in which case this test has nothing to toggle.
  const alertCard = panel.locator('[data-testid^="security-alert-"]').first();
  const hasOpenAlert = await alertCard.isVisible({ timeout: 5_000 }).catch(() => false);
  test.skip(!hasOpenAlert, "No OPEN alert to toggle in the current database state");

  // Capture which specific alert this is before the list re-filters out
  // from under us, so we can restore the exact same one afterward.
  const alertTestId = await alertCard.getAttribute("data-testid");

  await alertCard.getByRole("combobox").selectOption("RESOLVED");
  // Resolving it removes it from the OPEN-filtered list — that's the
  // correct behavior, not a stale reference to assert around.
  await expect(alertCard).not.toBeVisible();

  await panel.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => openAlertCount(page)).toBe(countBefore - 1);

  // Restore for idempotency across repeated runs.
  await page.getByTestId("node-security-alerts-group").click();
  await panel.getByRole("button", { name: "All", exact: true }).click();
  const restoredCard = page.getByTestId(alertTestId!);
  await expect(restoredCard).toBeVisible();
  await restoredCard.getByRole("combobox").selectOption("OPEN");
  await expect(restoredCard.getByRole("combobox")).toHaveValue("OPEN");

  await panel.getByRole("button", { name: "Close" }).click();
  await expect.poll(() => openAlertCount(page)).toBe(countBefore);
});
