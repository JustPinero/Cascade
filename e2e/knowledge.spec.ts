import { test, expect } from "@playwright/test";

test.describe("Knowledge Base", () => {
  test("loads knowledge page", async ({ page }) => {
    await page.goto("/knowledge");
    await expect(page.locator("h1")).toContainText("Knowledge Base");
  });

  test("shows search input", async ({ page }) => {
    await page.goto("/knowledge");
    await expect(page.getByPlaceholder(/search lessons/i)).toBeVisible();
  });

  test("navigates to category page", async ({ page }) => {
    await page.goto("/knowledge");
    // Click first category link (if any exist)
    const categoryLink = page.locator('a[href^="/knowledge/"]').first();
    if (await categoryLink.isVisible()) {
      await categoryLink.click();
      await expect(page.locator("text=Knowledge Base")).toBeVisible();
    }
  });
});
