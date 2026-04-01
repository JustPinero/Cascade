import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads and shows heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Dashboard");
  });

  test("shows scan button", async ({ page }) => {
    await page.goto("/");
    const scanBtn = page.getByRole("button", { name: /scan projects/i });
    await expect(scanBtn).toBeVisible();
  });

  test("shows activity log section", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Activity Log")).toBeVisible();
  });

  test("shows filter controls", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder(/search projects/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
  });
});
