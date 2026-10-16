import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test("login works and stays accessible on a phone", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
  const box = await page.getByRole("button", { name: "Anmeldelink senden" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectAccessible(page, "login (mobile)");
});
