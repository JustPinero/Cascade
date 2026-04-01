import { test, expect } from "@playwright/test";

test("app loads at localhost:3000", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/cascade|next/i);
});

test("page renders content", async ({ page }) => {
  await page.goto("/");
  const body = page.locator("body");
  await expect(body).toBeVisible();
});
