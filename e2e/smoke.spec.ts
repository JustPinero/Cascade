/**
 * Phase 23.8 — minimal smoke specs replacing the stale ones.
 *
 * Three thin smokes that catch "the page crashes at runtime" — what
 * `next build` doesn't catch. Selectors target stable structural
 * elements (page title + a single h2/h1) rather than copy that
 * tends to drift.
 */
import { test, expect } from "@playwright/test";

test.describe("smokes", () => {
  test("dashboard renders without throwing", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/cascade/i);
    // The sidebar h1 says "Cascade"; the main heading says "Dashboard".
    // Use the main heading specifically — sidebar h1 is on every page.
    await expect(
      page.getByRole("heading", { level: 1, name: /dashboard/i })
    ).toBeVisible();
  });

  test("Overseer chat page renders without throwing", async ({ page }) => {
    await page.goto("/delamain");
    await expect(page).toHaveTitle(/cascade.*delamain/i);
    // The page-level h2 says "Overseer".
    await expect(
      page.getByRole("heading", { level: 2, name: /overseer/i })
    ).toBeVisible();
  });

  test("/observability/cache renders without throwing", async ({ page }) => {
    await page.goto("/observability/cache");
    // Phase 23.3 page header is exact text. Tolerant of subsequent
    // copy edits via partial regex.
    await expect(
      page.getByRole("heading", { name: /anthropic cache observability/i })
    ).toBeVisible();
  });
});
