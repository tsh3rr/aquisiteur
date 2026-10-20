import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";

test("login works and stays accessible on a phone", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Mit Passkey anmelden" })).toBeVisible();
  const box = await page.getByRole("button", { name: "Anmeldelink senden" }).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expectAccessible(page, "login (mobile)");
});

test("the installable app ships sharp PNG icons for iOS and Android", async ({ page, request }) => {
  await page.goto("/login");
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(touchIcon).toBe("/icons/apple-touch-icon.png");

  const manifest = (await (await request.get("/manifest.webmanifest")).json()) as {
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon-192.png", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.png", sizes: "512x512" }),
      expect.objectContaining({ purpose: "maskable" }),
    ]),
  );

  for (const src of [
    touchIcon!,
    ...manifest.icons.map((icon) => icon.src),
    "/icons/badge-96.png",
  ]) {
    const response = await request.get(src);
    expect(response.status(), src).toBe(200);
  }
});
