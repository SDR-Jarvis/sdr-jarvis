import { test, expect } from "@playwright/test";

test("legal pages render without auth", async ({ page }) => {
  await page.goto("/legal/privacy");
  await expect(page.getByRole("heading", { name: /privacy policy/i })).toBeVisible();

  await page.goto("/legal/email-compliance");
  await expect(
    page.getByRole("heading", { name: /cold email/i })
  ).toBeVisible();
});
