import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * Phase 6: data subject rights (§9) and workspace data (§9a). The owner
 * exports a customer's data, sets a block marker, changes the retention
 * periods, exports the workspace and finally deletes it.
 */

const account = {
  email: "datenschutz@e2e.test",
  name: "Dana Datenschutz",
  workspace: "E2E Datenschutz",
  slug: "e2e-datenschutz",
};

test.describe.configure({ mode: "serial" });

async function owner(page: Page) {
  await signInWithWorkspace(page, account);
}

test("the owner exports a customer's data and sets a block marker", async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Datenschutz"));

  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  const card = page.locator("#datenschutz");
  await expect(card.getByRole("heading", { name: "Datenschutz" })).toBeVisible();

  const download = page.waitForEvent("download");
  await card.getByRole("link", { name: "Daten exportieren" }).click();
  const file = await (await download).path();
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    format: string;
    tables: Record<string, { companyName?: string }[]>;
  };
  expect(data.format).toBe("aquisiteur.prospect-export");
  expect(data.tables.prospects?.[0]?.companyName).toBe("Café Müller");

  await card.getByRole("button", { name: "Sperrvermerk setzen" }).click();
  await expect(card.getByText(/Sperrvermerk seit/)).toBeVisible();
  await expect(card.getByText(/Besuchsdaten werden am .* gelöscht/)).toBeVisible();
  await expect(page.getByText("Nicht mehr kontaktieren")).toBeVisible();
  await expectAccessible(page, "customer page with privacy card");

  await card.getByRole("button", { name: "Sperrvermerk aufheben" }).click();
  await expect(card.getByRole("button", { name: "Sperrvermerk setzen" })).toBeVisible();
});

test("the owner writes the legal pages and checks the limits", async ({ page }) => {
  await owner(page);
  await page.goto("/settings#rechtliches");
  const legal = page.locator("#rechtliches");
  await legal
    .getByLabel("Impressum")
    .fill("**Dana Datenschutz**\n\nMusterweg 1, 12345 Musterstadt");
  await legal.getByRole("button", { name: "Rechtstexte speichern" }).click();
  await expect(legal.getByText(/Gespeichert/)).toBeVisible();

  const system = page.locator("#system");
  await expect(system.getByText("Veröffentlichte Exposés")).toBeVisible();
  await expect(system.getByText("Besuche in diesem Monat")).toBeVisible();
  await expectAccessible(page, "settings with legal and system cards");

  const host = `http://${account.slug}.localhost:${new URL(E2E.baseURL).port}`;
  await page.goto(`${host}/impressum`);
  await expect(page.getByText("Musterweg 1, 12345 Musterstadt")).toBeVisible();
  await page.goto(`${host}/datenschutz`);
  await expect(page.getByText(/Lesestatistik, nur mit Ihrer Zustimmung/)).toBeVisible();
  await expect(page.getByText(/Lesestatistik löschen wir nach 180 Tagen/)).toBeVisible();
  await expectAccessible(page, "generated privacy page");
});

test("the owner sets retention, exports and deletes the workspace", async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  await page.goto("/settings#daten");
  const card = page.locator("#daten");
  await card.getByLabel("Ereignisse (Tage)").fill("180");
  await card.getByRole("button", { name: "Fristen speichern" }).click();
  await expect(card.getByText(/Gespeichert/)).toBeVisible();
  await expectAccessible(page, "settings with data card");

  const download = page.waitForEvent("download");
  await card.getByRole("link", { name: "Alle Daten exportieren" }).click();
  const file = await (await download).path();
  const data = JSON.parse(readFileSync(file, "utf8")) as {
    workspace: { slug: string };
    tables: Record<string, unknown[]>;
  };
  expect(data.workspace.slug).toBe(account.slug);
  expect(data.tables.prospects?.length).toBeGreaterThan(0);

  await card.getByText("Workspace löschen …").click();
  await card.getByLabel(/Zur Bestätigung/).fill("falsch");
  await card.getByRole("button", { name: "Workspace endgültig löschen" }).click();
  await expect(card.getByText(`Bitte genau „${account.slug}“ eingeben.`)).toBeVisible();
  await card.getByLabel(/Zur Bestätigung/).fill(account.slug);
  await card.getByRole("button", { name: "Workspace endgültig löschen" }).click();
  // Without a workspace the account lands in onboarding again.
  await expect(page).toHaveURL(/\/onboarding/);
});
