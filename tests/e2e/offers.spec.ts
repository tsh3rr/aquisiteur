import { expect, test } from "@playwright/test";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * §7.10 Phase 7a: catalogue → project → offer with instalments and a
 * maintenance line → the customer picks an option and accepts online → the
 * customer counts as won and the timeline shows it.
 */

const account = {
  email: "angebote@e2e.test",
  name: "Olga Offerte",
  workspace: "E2E Angebote",
  slug: "e2e-angebote",
};

test("an offer goes from the catalogue to an online acceptance", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signInWithWorkspace(page, account);
  publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Angebote"));

  // Settings: tax mode stays Kleinunternehmer; two catalogue entries.
  await page.goto("/settings#leistungen");
  const billing = page.locator("#angebote");
  await expect(billing.getByLabel("Umsatzsteuer")).toHaveValue("small_business");
  const catalog = page.locator("#leistungen");
  await catalog.getByLabel("Name").fill("Website Basis");
  await catalog.getByLabel("Preis netto in Euro").fill("2.400,00");
  await catalog.getByRole("button", { name: "Leistung anlegen" }).click();
  await expect(catalog.getByText("„Website Basis“ steht jetzt im Katalog.")).toBeVisible();
  await catalog.getByLabel("Name").fill("Wartung und Hosting");
  await catalog.getByLabel("Preis netto in Euro").fill("49");
  await catalog.getByLabel("Abrechnung").selectOption("monthly");
  await catalog.getByRole("button", { name: "Leistung anlegen" }).click();
  await expect(catalog.getByText("Wartung und Hosting", { exact: true })).toBeVisible();
  await expectAccessible(page, "settings with billing and catalogue");

  // Customer → project (created with the exposé) → new offer from the catalogue.
  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  const projects = page.locator("#projekte");
  await expect(
    projects.getByText("Noch kein Angebot.").or(projects.getByText(/Exposé, noch kein Angebot/)),
  ).toBeVisible();
  await projects.getByRole("link", { name: /Erstakquise/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Erstakquise" })).toBeVisible();
  await page.getByLabel("Website Basis").check();
  await page.getByLabel("Wartung und Hosting").check();
  await page.getByLabel(/Titel des neuen Angebots/).fill("Neue Website für das Café");
  await expectAccessible(page, "project page");
  await page.getByRole("button", { name: "Angebot erstellen" }).click();

  // Editor: instalments 50/50, then finish (number, version 1, public link).
  await expect(
    page.getByRole("heading", { level: 1, name: "Neue Website für das Café" }),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Vorlagen" })
    .getByRole("button", { name: "50/50" })
    .click();
  await expectAccessible(page, "offer editor");
  await page.getByRole("button", { name: "Angebot fertigstellen" }).click();
  await expect(page.getByText(/Angebot AN-\d{4}-0001 ist bereit/)).toBeVisible();
  const link = page.getByRole("complementary", { name: "Zusammenfassung" }).locator("code");
  await expect(link).toContainText("/a/");
  const offerUrl = (await link.textContent())!.trim();

  // The customer opens the link on another device, adds nothing and accepts.
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  await customer.goto(offerUrl);
  await expect(
    customer.getByRole("heading", { level: 1, name: "Neue Website für das Café" }),
  ).toBeVisible();
  const sum = customer.getByRole("region", { name: "Summe" });
  await expect(sum).toContainText("2.400,00 €");
  await expect(sum).toContainText("49,00 €");
  await expect(sum).toContainText("§ 6 Abs. 1 Z 27 UStG");
  const plan = customer.getByRole("region", { name: "Zahlungsplan" });
  await expect(plan.getByRole("listitem")).toHaveCount(2);
  await expect(plan).toContainText("1.200,00 €");
  await expectAccessible(customer, "public offer page");

  await customer.getByRole("button", { name: "Verbindlich annehmen" }).click();
  await expect(customer.getByText(/Bitte bestätigen Sie die Beauftragung/)).toBeVisible();
  await customer.getByLabel("Ihr Name").fill("Maria Müller");
  await customer.getByLabel(/Ich beauftrage/).check();
  await customer.getByRole("button", { name: "Verbindlich annehmen" }).click();
  await expect(customer.getByText(/Ihr Auftrag ist bei .* angekommen/)).toBeVisible();
  await customer.reload();
  await expect(customer.getByText(/Angenommen am .* von Maria Müller/)).toBeVisible();
  await expect(customer.getByRole("button", { name: "Verbindlich annehmen" })).toHaveCount(0);
  await customerContext.close();

  // Cockpit: the offer is accepted, the customer won, the timeline says so.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Angenommen" })).toBeVisible();
  await expect(page.getByText(/von Maria Müller/).first()).toBeVisible();
  await page.goto("/angebote");
  await expect(page.getByRole("link", { name: /Neue Website für das Café/ })).toBeVisible();
  await expectAccessible(page, "offer list");
  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  await expect(page.getByText("Gewonnen").first()).toBeVisible();
  await expect(page.getByText(/Angebot AN-\d{4}-0001 angenommen/)).toBeVisible();
});
