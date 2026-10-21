import { expect, test } from "@playwright/test";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * §7.9 Pingen as print provider: the owner stores the credentials (staging),
 * and the letter list offers „Per Pingen versenden“ with a confirmation.
 * Nothing reaches Pingen here; the adapter is covered by unit and DB tests.
 */

test("Pingen is set up in the settings and offered for draft letters", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithWorkspace(page, {
    email: "pingen@e2e.test",
    name: "Paul Pingen",
    workspace: "E2E Pingen",
    slug: "e2e-pingen",
  });
  publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Pingen"));

  await page.goto("/settings#briefe");
  const card = page.locator("#briefe");
  await card.getByLabel(/Pingen druckt und verschickt/).check();
  await card.getByLabel("Organisations-ID").fill("org-e2e");
  await card.getByLabel("Client-ID").fill("client-e2e");
  await card.getByLabel("Client-Secret").fill("secret-e2e");
  await expect(card.getByLabel("Testumgebung von Pingen verwenden")).toBeChecked();
  await expect(card.getByText(/\/api\/webhooks\/pingen\//)).toBeVisible();
  await expectAccessible(page, "print service settings");
  await card.getByRole("button", { name: "Speichern" }).last().click();
  await expect(
    card.getByText("Gespeichert. Briefe lassen sich jetzt per Pingen versenden."),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator("#briefe").getByText("Gespeichert. Leer lassen, um es zu behalten."),
  ).toBeVisible();

  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  await page.waitForURL(/\/kunden\/[0-9a-f-]{36}/);
  const prospectId = new URL(page.url()).pathname.split("/").pop()!;
  await page.goto(`/briefe/neu?ids=${prospectId}`);
  await page.getByRole("button", { name: "1 Brief erstellen" }).click();
  await expect(page.getByText(/1 Brief erstellt/)).toBeVisible();

  const actions = page.getByRole("group", { name: "Sammelaktionen" });
  await actions.getByRole("button", { name: "Per Pingen versenden" }).click();
  await expect(
    actions.getByText("1 Brief an die Pingen-Testumgebung senden? Dort wird nichts gedruckt."),
  ).toBeVisible();
  await expectAccessible(page, "letter list with Pingen confirmation");
  await actions.getByRole("button", { name: "Abbrechen" }).click();
  await expect(actions.getByRole("button", { name: "Per Pingen versenden" })).toBeVisible();
});
