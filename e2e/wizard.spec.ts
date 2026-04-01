import { test, expect } from "@playwright/test";

test.describe("Project Wizard", () => {
  test("loads wizard page", async ({ page }) => {
    await page.goto("/create");
    await expect(page.locator("h1")).toContainText("Create Project");
  });

  test("shows step indicator", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByText("Step 1 of 7")).toBeVisible();
  });

  test("shows project name input on first step", async ({ page }) => {
    await page.goto("/create");
    await expect(page.getByPlaceholder(/my awesome project/i)).toBeVisible();
  });

  test("next button is disabled without project name", async ({ page }) => {
    await page.goto("/create");
    const nextBtn = page.getByRole("button", { name: "Next" });
    await expect(nextBtn).toBeDisabled();
  });
});
