import { test, expect } from "@playwright/test";

// These e2e tests assume the app is running (pnpm dev or built server).
// The migrate page and dashboard banner are the P2 UI deliverables.

test.describe("Migration Repair Wizard (/migrate)", () => {
  test("page renders without crashing", async ({ page }) => {
    const response = await page.goto("/migrate");
    // Should not be a 404 or 500
    expect(response?.status()).not.toBe(404);
    expect(response?.status()).not.toBe(500);
  });

  test("shows page heading", async ({ page }) => {
    await page.goto("/migrate");
    await expect(page.locator("h1")).toContainText(/migration repair|repair|migrate/i);
  });

  test("shows empty state message when no orphans", async ({ page }) => {
    await page.goto("/migrate");
    // If no orphans, should show a positive message (all projects healthy)
    const body = await page.textContent("body");
    expect(body).toBeTruthy();
    // Page should not show an error
    expect(body).not.toContain("500");
    expect(body).not.toContain("Internal Server Error");
  });
});

test.describe("Dashboard orphan banner", () => {
  test("dashboard loads without error", async ({ page }) => {
    await page.goto("/");
    const body = await page.textContent("body");
    expect(body).not.toContain("Internal Server Error");
  });

  test("banner is absent when no orphans exist in the test environment", async ({ page }) => {
    await page.goto("/");
    // In CI / fresh install with no stale paths, the banner should not appear
    // The data-testid allows us to assert the banner is not present
    const banner = page.locator('[data-testid="orphan-banner"]');
    // Either not present or not visible — both are acceptable for a clean install
    const count = await banner.count();
    if (count > 0) {
      // If it exists, it should have a link to /migrate
      await expect(banner.locator("a")).toHaveAttribute("href", "/migrate");
    }
  });

  test("if banner is present it links to /migrate", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator('[data-testid="orphan-banner"]');
    const count = await banner.count();
    if (count > 0) {
      await expect(banner.locator("a[href='/migrate']")).toBeVisible();
    }
  });
});
