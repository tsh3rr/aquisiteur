import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
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
