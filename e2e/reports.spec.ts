import { test, expect } from "@playwright/test";

test.describe("Reports", () => {
  test("loads reports page", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.locator("h1")).toContainText("Reports");
  });

  test("shows report type buttons", async ({ page }) => {
    await page.goto("/reports");
    await expect(
      page.getByRole("button", { name: "Single Project" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cross-Project" })
    ).toBeVisible();
  });

  test("generate button visible for cross-project", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("button", { name: "Cross-Project" }).click();
    const genBtn = page.getByRole("button", { name: /generate report/i });
    await expect(genBtn).toBeVisible();
  });
});
