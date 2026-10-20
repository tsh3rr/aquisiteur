import { devices, expect, test, type Page } from "@playwright/test";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * Global search, command palette and keyboard shortcuts (§7.8): ⌘K / Strg+K
 * finds a customer in any umlaut spelling, sequences like "G K" navigate,
 * single-key shortcuts can be switched off, and the phone has a search button.
 */

const account = {
  email: "suche@e2e.test",
  name: "Sina Suche",
  workspace: "E2E Suche",
  slug: "e2e-suche",
};

test.describe.configure({ mode: "serial" });

async function owner(page: Page) {
  await signInWithWorkspace(page, account);
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Suche und Befehle" });

test("Strg+K finds a customer and opens it with the keyboard", async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Suche"));
  await page.goto("/");

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  const input = palette(page).getByRole("combobox", { name: "Suchen" });
  await expect(input).toBeFocused();
  // Without a query the palette lists pages and actions.
  await expect(palette(page).getByRole("option", { name: "Pipeline" })).toBeVisible();
  await expectAccessible(page, "command palette (empty)");

  await input.fill("mueller");
  const customers = palette(page).getByRole("group", { name: "Kunden" });
  await expect(customers.getByRole("option", { name: /Café Müller/ })).toBeVisible();
  await expect(palette(page).getByRole("group", { name: "Exposés" })).toBeVisible();
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    (await customers.getByRole("option").first().getAttribute("id"))!,
  );
  await expectAccessible(page, "command palette (results)");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kunden\/[0-9a-f-]{36}$/);
  await expect(palette(page)).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Café Müller" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await input.fill("gibtsnicht");
  await expect(palette(page).getByRole("status")).toHaveText("Keine Treffer für „gibtsnicht“.");
  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});

test("key sequences navigate and can be switched off", async ({ page }) => {
  await owner(page);
  await page.goto("/");

  await page.keyboard.press("g");
  await page.keyboard.press("k");
  await expect(page).toHaveURL(/\/kunden$/);

  await page.keyboard.press("Shift+?");
  const help = page.getByRole("dialog", { name: "Tastaturkürzel" });
  await expect(help).toBeVisible();
  await expect(help.getByRole("cell", { name: "Pipeline" })).toBeVisible();
  await expectAccessible(page, "shortcut help");

  const toggle = help.getByRole("checkbox", { name: "Kürzel mit einzelnen Tasten" });
  await toggle.uncheck();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/kunden$/);

  // The modifier shortcut keeps working; the palette's action reopens the help.
  await page.keyboard.press("Control+k");
  await palette(page).getByRole("combobox").fill("tastatur");
  await page.keyboard.press("Enter");
  await expect(help).toBeVisible();
  await toggle.check();
  await page.keyboard.press("Escape");
  await page.keyboard.press("g");
  await page.keyboard.press("h");
  await expect(page).toHaveURL(/\/$/);

  // Typing in a field never triggers single-key shortcuts.
  await page.goto("/kunden");
  await page.getByRole("searchbox").first().fill("gk");
  await expect(page).toHaveURL(/\/kunden(\?.*)?$/);
});

test.describe("on a phone", () => {
  // Same browser, phone viewport and touch (a browser type switch needs a new worker).
  const { defaultBrowserType: _browser, ...phone } = devices["Pixel 7"];
  test.use(phone);

  test("the header search button opens the palette", async ({ page }) => {
    await owner(page);
    await page.goto("/");
    const button = page.getByRole("banner").getByRole("button", { name: "Suchen" });
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(palette(page)).toBeVisible();
    await palette(page).getByRole("combobox").fill("pipeline");
    await palette(page).getByRole("option", { name: "Pipeline" }).click();
    await expect(page).toHaveURL(/\/kunden\/pipeline$/);
    await expect(palette(page)).toBeHidden();

    await button.click();
    await expectAccessible(page, "command palette (mobile)");
    await palette(page).getByRole("button", { name: "Fertig" }).click();
    await expect(palette(page)).toBeHidden();
    await expect(button).toBeFocused();
  });
});
