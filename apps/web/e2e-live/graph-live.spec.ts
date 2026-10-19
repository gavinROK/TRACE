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

  // Capture which specific alert this is — `.first()` is a live locator
  // that re-evaluates against whatever matches *now*, so once the list
  // changes it can silently point at a different alert. Scoping by this
  // id instead (as the restoration below already did) is what makes the
  // "not visible" assertion actually test the alert we resolved, not
  // just "is anything first" — this matters as soon as more than one
  // open alert exists, which the device posture rule now produces.
  const alertTestId = await alertCard.getAttribute("data-testid");
  const resolvedCard = page.getByTestId(alertTestId!);

  await alertCard.getByRole("combobox").selectOption("RESOLVED");
  // Resolving it removes it from the OPEN-filtered list — that's the
  // correct behavior, not a stale reference to assert around.
  await expect(resolvedCard).not.toBeVisible();

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

// Note: the device *enrollment* flow (the modal, POST /devices, the graph
// refetching afterward) was verified manually via browser automation
// rather than getting a permanent test here — there is no DELETE
// endpoint for devices yet, so unlike every other mutation this suite
// exercises, an enrollment test would leave a new row in the database on
// every single run with no way to clean it up, breaking the idempotency
// the rest of this suite deliberately maintains. These tests cover the
// read side, which real seeded data makes idempotent to assert against.

test("shows the devices group populated with real seeded devices and posture", async ({
  page,
}) => {
  const deviceGroup = page.getByTestId("node-device-group");
  await expect(deviceGroup).toBeVisible();
  await expect(deviceGroup).toContainText("Devices");

  // Seeded by apps/api/prisma/seed.ts — device names are stable.
  const priyaDevice = page
    .locator('[data-testid^="node-"]')
    .filter({ hasText: "Priya Sharma's MacBook Air" });
  await expect(priyaDevice.first()).toBeVisible();
  // Seeded with two failing posture checks (OS updates, screen lock) ->
  // CRITICAL, rendered as "CRITICAL" in the node's metric line.
  await expect(priyaDevice.first()).toContainText("CRITICAL");

  const sharedServer = page.locator('[data-testid^="node-"]').filter({ hasText: "prod-db-01" });
  await expect(sharedServer.first()).toBeVisible();
});

test("opens a device's detail panel and shows its real posture fields", async ({ page }) => {
  const priyaDevice = page
    .locator('[data-testid^="node-"]')
    .filter({ hasText: "Priya Sharma's MacBook Air" })
    .first();
  await priyaDevice.click();

  const panel = page.getByTestId("device-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Priya Sharma"); // owner
  await expect(panel).toContainText("macOS 14.6");
  await expect(panel).toContainText("SIMULATED");
  await expect(panel).toContainText("CRITICAL");
  // Seeded explicitly false for this device.
  await expect(panel).toContainText(/OS up to date\s*No/);
  await expect(panel).toContainText(/Screen lock\s*No/);

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).not.toBeAttached();
});

test("shows a device's installed software and department assignment on its profile", async ({
  page,
}) => {
  // Ada Chen's laptop is seeded with two software rows (apps/api/prisma/seed.ts).
  const adaDevice = page
    .locator('[data-testid^="node-"]')
    .filter({ hasText: "Ada Chen's MacBook Pro" })
    .first();
  await adaDevice.click();

  const panel = page.getByTestId("device-profile-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Installed software (2)");
  await expect(panel).toContainText("Visual Studio Code");
  await expect(panel).toContainText("Docker Desktop");

  await panel.getByRole("button", { name: "Close" }).click();

  // core-switch-01 is departmentId-assigned (Operations), not owned by a
  // person — the profile should show the department, not "Unassigned".
  const switchDevice = page
    .locator('[data-testid^="node-"]')
    .filter({ hasText: "core-switch-01" })
    .first();
  await switchDevice.click();
  const switchPanel = page.getByTestId("device-profile-panel");
  await expect(switchPanel).toBeVisible();
  await expect(switchPanel).toContainText("Operations");
  await expect(switchPanel).toContainText("Cisco IOS Firmware");
  await switchPanel.getByRole("button", { name: "Close" }).click();
});

test("opens the device inventory panel and searches/filters the seeded fleet", async ({ page }) => {
  await page.getByTestId("node-device-group").click();

  const panel = page.getByTestId("device-inventory-panel");
  await expect(panel).toBeVisible();

  // Every seeded device should be listed.
  await expect(panel.getByTestId("device-inventory-row-device-priya-laptop")).toBeVisible();
  await expect(panel.getByTestId("device-inventory-row-device-core-switch")).toBeVisible();

  // Search narrows the list to just the matching device.
  await panel.getByTestId("device-inventory-search").fill("Priya");
  await expect(panel.getByTestId("device-inventory-row-device-priya-laptop")).toBeVisible();
  await expect(panel.getByTestId("device-inventory-row-device-core-switch")).not.toBeVisible();
  await panel.getByTestId("device-inventory-search").fill("");

  // Filtering by posture status narrows to only CRITICAL devices, which
  // includes Priya's laptop (seeded with two failing posture checks).
  await panel.getByLabel("Filter by security posture").selectOption("CRITICAL");
  await expect(panel.getByTestId("device-inventory-row-device-priya-laptop")).toBeVisible();
  await panel.getByLabel("Filter by security posture").selectOption("ALL");

  // Clicking a row opens that device's profile panel.
  await panel.getByTestId("device-inventory-row-device-priya-laptop").click();
  const profile = page.getByTestId("device-profile-panel");
  await expect(profile).toBeVisible();
  await expect(profile).toContainText("Priya Sharma's MacBook Air");
  await profile.getByRole("button", { name: "Close" }).click();
});

test("the device posture rule's findings appear as real security alerts", async ({ page }) => {
  // Re-running detection is itself idempotent (dedup), so this is safe
  // to call unconditionally rather than depending on prior test ordering.
  await page.evaluate(async () => {
    await fetch("/api/trace/security/alerts/run", { method: "POST" });
  });

  await page.getByTestId("node-security-alerts-group").click();
  const panel = page.getByTestId("security-alerts-panel");
  await panel.getByRole("button", { name: "All", exact: true }).click();

  // Priya's device also triggers DeviceDataQualityRule's stale-checkin
  // finding (seeded 200 days ago) — filter by alert type too, not just
  // the device name, so this doesn't depend on which one `.first()` picks.
  const deviceAlert = panel
    .locator('[data-testid^="security-alert-"]')
    .filter({ hasText: "Priya Sharma's MacBook Air" })
    .filter({ hasText: "Device Posture Risk" });
  await expect(deviceAlert.first()).toBeVisible({ timeout: 10_000 });
  await expect(deviceAlert.first()).toContainText("Device Posture Risk");
});

test("the device data-quality rule's findings (missing info, stale check-in) appear as real security alerts", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await fetch("/api/trace/security/alerts/run", { method: "POST" });
  });

  await page.getByTestId("node-security-alerts-group").click();
  const panel = page.getByTestId("security-alerts-panel");
  await panel.getByRole("button", { name: "All", exact: true }).click();

  // Devon Lee's ThinkPad is seeded with every posture flag null and no
  // check-in — exactly the "unknown, not confirmed-risky" case this rule
  // exists to surface, distinct from Priya's confirmed CRITICAL posture.
  const missingInfoAlert = panel
    .locator('[data-testid^="security-alert-"]')
    .filter({ hasText: "Devon Lee's ThinkPad" });
  await expect(missingInfoAlert.first()).toBeVisible({ timeout: 10_000 });
  await expect(missingInfoAlert.first()).toContainText("Device Missing Security Info");

  // Priya's laptop is seeded with a check-in 200 days ago — stale.
  const staleCheckinAlert = panel
    .locator('[data-testid^="security-alert-"]')
    .filter({ hasText: "Priya Sharma's MacBook Air" })
    .filter({ hasText: "Device Stale Checkin" });
  await expect(staleCheckinAlert.first()).toBeVisible({ timeout: 10_000 });
});
