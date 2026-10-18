import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // React Flow's own fitView animation and layout settle briefly after
  // first paint; wait for the root node rather than the bare page load.
  await expect(page.getByTestId("node-org")).toBeVisible();
});

test("renders the header, stats row, and initial graph shape", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "TRACE" })).toBeVisible();
  await expect(page.getByText("Developers")).toBeVisible();
  await expect(page.getByText("Open Pull Requests")).toBeVisible();

  await expect(page.getByTestId("node-org")).toContainText("Acme Corp");
  await expect(page.getByTestId("node-dept-engineering")).toContainText("Engineering");
  await expect(page.getByTestId("node-dev-ada")).toContainText("Ada Chen");

  // Developers start expanded (visible), but their own GitHub/API/Security
  // metric leaves start collapsed.
  await expect(page.getByTestId("node-dev-ada-github")).not.toBeAttached();
});

test("expands a developer node to reveal its metric leaves, then collapses it again", async ({
  page,
}) => {
  await page.getByTestId("node-toggle-dev-ada").click();

  await expect(page.getByTestId("node-dev-ada-github")).toBeVisible();
  await expect(page.getByTestId("node-dev-ada-api")).toBeVisible();
  await expect(page.getByTestId("node-dev-ada-security")).toBeVisible();

  await page.getByTestId("node-toggle-dev-ada").click();

  await expect(page.getByTestId("node-dev-ada-github")).not.toBeAttached();
});

test("collapses a department to hide its developers, then expands it again", async ({
  page,
}) => {
  await expect(page.getByTestId("node-dev-ada")).toBeVisible();

  await page.getByTestId("node-toggle-dept-engineering").click();
  await expect(page.getByTestId("node-dev-ada")).not.toBeAttached();
  await expect(page.getByTestId("node-dev-marcus")).not.toBeAttached();

  await page.getByTestId("node-toggle-dept-engineering").click();
  await expect(page.getByTestId("node-dev-ada")).toBeVisible();
});

test("opens the detail panel for a node and closes it", async ({ page }) => {
  await expect(page.getByTestId("detail-panel")).not.toBeAttached();

  await page.getByTestId("node-dev-ada").click();

  const panel = page.getByTestId("detail-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Ada Chen");
  await expect(panel).toContainText("Staff Engineer");

  await panel.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("detail-panel")).not.toBeAttached();
});

test("filters developers by activity level", async ({ page }) => {
  // dev-ada is "high" activity, dev-marcus is "medium".
  await expect(page.getByTestId("node-dev-ada")).toBeVisible();
  await expect(page.getByTestId("node-dev-marcus")).toBeVisible();

  await page.getByRole("button", { name: "High", exact: true }).click();

  await expect(page.getByTestId("node-dev-ada")).toBeVisible();
  await expect(page.getByTestId("node-dev-marcus")).not.toBeAttached();

  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByTestId("node-dev-marcus")).toBeVisible();
});

test("toggling a metric kind in the filter bar hides it across all developers", async ({
  page,
}) => {
  await page.getByTestId("node-toggle-dev-ada").click();
  await expect(page.getByTestId("node-dev-ada-github")).toBeVisible();

  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(page.getByTestId("node-dev-ada-github")).not.toBeAttached();

  await page.getByRole("button", { name: "GitHub", exact: true }).click();
  await expect(page.getByTestId("node-dev-ada-github")).toBeVisible();
});

test("exports the graph as a JSON Canvas file", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON Canvas" }).click();

  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("trace-org-graph.canvas");
});
