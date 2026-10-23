import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * §7.10 Phase 7a: catalogue → project → offer with instalments and a
 * maintenance line → the customer picks an option and accepts online → the
 * customer counts as won and the timeline shows it.
 * Phase 7b: invoices from the instalments → issue with a number → PDF →
 * partial payment → storno. Phase 7c: VIES check, Factur-X, month ZIP,
 * deletion request with retained invoices, e-mail with the invoice page, a
 * maintenance contract billed by the hourly job.
 */

const account = {
  email: "angebote@e2e.test",
  name: "Olga Offerte",
  workspace: "E2E Angebote",
  slug: "e2e-angebote",
};

test("an offer goes from the catalogue to an online acceptance", async ({ page, browser }) => {
  test.setTimeout(240_000);
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

  // Invoices need the sender's address, an IBAN for the QR code and the customer's address.
  await page.goto("/settings#briefe");
  const letters = page.locator("#briefe");
  await letters.getByLabel("Firma oder Name").fill("Olga Offerte Webdesign");
  await letters.getByLabel("Straße und Hausnummer").fill("Hauptstraße 1");
  await letters.getByLabel("PLZ").fill("1010");
  await letters.getByLabel("Ort").fill("Wien");
  await letters.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(letters.getByText("Gespeichert.")).toBeVisible();
  await billing.getByLabel("Steuernummer").fill("12 345/6789");
  await billing.getByLabel("IBAN").fill("AT61 1904 3002 3457 3201");
  await billing.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(billing.getByText("Gespeichert.")).toBeVisible();

  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  await page.getByRole("tab", { name: "Stammdaten" }).click();
  const profile = page.locator("#rechnungsprofil");
  await profile.getByLabel("Straße und Hausnummer").fill("Markt 1");
  await profile.getByLabel("PLZ").fill("8010");
  await profile.getByLabel("Ort").fill("Graz");
  // VIES checks the customer's UID on save (fake provider: a trailing 0 is invalid).
  await profile.getByLabel("UID-Nummer des Kunden").fill("ATU12345670");
  await profile.getByRole("button", { name: "Rechnungsprofil speichern" }).click();
  await expect(profile.getByText("die UID ist laut VIES ungültig")).toBeVisible();
  await profile.getByLabel("UID-Nummer des Kunden").fill("ATU12345678");
  await profile.getByRole("button", { name: "Rechnungsprofil speichern" }).click();
  await expect(profile.getByText("UID laut VIES gültig")).toBeVisible();
  const shots = process.env.SCREENSHOT_DIR;
  if (shots) await profile.screenshot({ path: `${shots}/vies-check.png` });
  // Without a UID the café stays a domestic customer for the rest of the flow.
  await profile.getByLabel("UID-Nummer des Kunden").fill("");
  await profile.getByRole("button", { name: "Rechnungsprofil speichern" }).click();
  await expect(profile.getByText("Rechnungsprofil gespeichert.", { exact: true })).toBeVisible();
  await expectAccessible(page, "customer billing profile");

  // Accepted offer → one draft per instalment: a deposit and the final invoice.
  await page.goto("/angebote");
  await page.getByRole("link", { name: /Neue Website für das Café/ }).click();
  await page.getByRole("button", { name: "Rechnungen aus Tranchen erstellen" }).click();
  await expect(page.getByText("2 Rechnungsentwürfe angelegt.")).toBeVisible();
  await page.getByRole("link", { name: /Entwurf · Anzahlungsrechnung · 1\.200,00 €/ }).click();

  await expect(page.getByRole("heading", { level: 1, name: /Anzahlungsrechnung/ })).toBeVisible();
  await expect(page.getByLabel("Umsatzsteuer")).toHaveValue("small_business");
  await expectAccessible(page, "invoice editor");
  await page.getByRole("button", { name: "Rechnung ausstellen" }).click();
  // The editor gives way to the issued invoice with its number.
  await expect(page.getByRole("heading", { level: 1, name: /RE-\d{4}-0001/ })).toBeVisible();
  await expect(page.getByText("§ 6 Abs. 1 Z 27 UStG").first()).toBeVisible();
  await expectAccessible(page, "issued invoice");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF herunterladen" }).click();
  expect((await download).suggestedFilename()).toMatch(/^RE-\d{4}-0001.*\.pdf$/);
  // The issued invoice is a Factur-X / ZUGFeRD file: PDF/A-3 with the XML attached (ADR-0071).
  const pdfBytes = readFileSync((await (await download).path())!).toString("latin1");
  expect(pdfBytes).toContain("factur-x.xml");
  expect(pdfBytes).toContain("<pdfaid:part>3</pdfaid:part>");
  if (process.env.E2E_KEEP_PDF) await (await download).saveAs(process.env.E2E_KEEP_PDF);

  // By e-mail (7c-2): the PDF rendered here goes along, the link leads to the invoice page.
  const shipping = page.locator("#versand");
  await shipping.getByLabel("An").fill("buchhaltung@cafe-mueller.test");
  await shipping.getByRole("button", { name: "Per E-Mail senden" }).click();
  await expect(
    shipping.getByText("Rechnung an buchhaltung@cafe-mueller.test gesendet."),
  ).toBeVisible();
  await expect(shipping.getByText("Versendet", { exact: true })).toBeVisible();
  await expectAccessible(page, "invoice shipping");
  if (process.env.SCREENSHOT_DIR) {
    await shipping.screenshot({ path: `${process.env.SCREENSHOT_DIR}/invoice-shipping.png` });
  }
  const mail = readFileSync(E2E.mailLog, "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          to: string;
          text: string;
          attachments?: { filename: string; bytes: number }[];
        },
    )
    .filter((entry) => entry.to === "buchhaltung@cafe-mueller.test")
    .at(-1)!;
  expect(mail.attachments![0]!.filename).toMatch(/^RE-\d{4}-0001\.pdf$/);
  expect(mail.attachments![0]!.bytes).toBeGreaterThan(10_000);
  const invoiceUrl = mail.text.match(/https?:\/\/\S+\/r\/[0-9A-Za-z]{22}/)![0];
  const reader = await browser.newContext();
  const readerPage = await reader.newPage();
  await readerPage.goto(invoiceUrl);
  await expect(
    readerPage.getByRole("heading", { level: 1, name: /Anzahlungsrechnung RE-\d{4}-0001/ }),
  ).toBeVisible();
  await expectAccessible(readerPage, "public invoice page");
  if (process.env.SCREENSHOT_DIR) {
    await readerPage.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/public-invoice.png`,
      fullPage: true,
    });
  }
  const stored = readerPage.waitForEvent("download");
  await readerPage.getByRole("link", { name: "PDF herunterladen" }).click();
  expect((await stored).suggestedFilename()).toMatch(/^RE-\d{4}-0001\.pdf$/);
  await reader.close();

  await page.getByLabel("Betrag in €").fill("500,00");
  await page.getByRole("button", { name: "Zahlung erfassen" }).click();
  await expect(page.getByText("Teilweise bezahlt").first()).toBeVisible();

  await page.getByRole("button", { name: "Stornieren …" }).click();
  await page.getByRole("button", { name: "Jetzt stornieren" }).click();
  // The page reloads as cancelled and links the cancellation invoice.
  await expect(page.getByRole("status").getByRole("link", { name: /RE-\d{4}-0002/ })).toBeVisible();
  await expect(page.getByText("Storniert", { exact: true }).first()).toBeVisible();

  await page.goto("/rechnungen");
  await expect(page.getByRole("link", { name: /RE-\d{4}-0002/ })).toBeVisible();
  await expectAccessible(page, "invoice list");

  // The month for the tax adviser: CSV plus every issued invoice as PDF in one ZIP.
  await page.getByLabel("Monat").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Anzeigen" }).click();
  const zip = page.waitForEvent("download");
  await page.getByRole("button", { name: /^ZIP für / }).click();
  expect((await zip).suggestedFilename()).toMatch(/^rechnungen-\d{4}-\d{2}\.zip$/);
  await expect(page.getByText("ZIP mit 2 Rechnungen erstellt.")).toBeVisible();

  // Maintenance (7c-3): the monthly line becomes a contract; the hourly job drafts its
  // first, prorated invoice and asks for approval with a task.
  await page.goto("/angebote");
  await page.getByRole("link", { name: /Neue Website für das Café/ }).click();
  await page.getByRole("button", { name: "Wartungsvertrag anlegen" }).click();
  // The page refreshes with the new contract, and the button goes away with it.
  await expect(page.getByRole("button", { name: "Wartungsvertrag anlegen" })).toHaveCount(0);
  await page.getByRole("link", { name: /Wartung: Neue Website für das Café/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Wartung: Neue Website für das Café" }),
  ).toBeVisible();
  await expect(page.getByText("Beginn offen")).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel("Beginn", { exact: true }).fill(today);
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert.")).toBeVisible();
  const job = await page.request.post("/api/jobs/hourly", {
    headers: { authorization: `Bearer ${E2E.cronSecret}` },
  });
  expect(job.ok()).toBe(true);
  expect((await job.json()).contracts).toMatchObject({ drafted: 1, approvals: 1 });
  await page.reload();
  await expect(page.getByRole("link", { name: /Entwurf · Rechnung/ })).toBeVisible();
  await expect(page.getByText("Läuft", { exact: true })).toBeVisible();
  await expectAccessible(page, "maintenance contract");
  if (shots) await page.screenshot({ path: `${shots}/maintenance-contract.png`, fullPage: true });
  await page.goto("/rechnungen/vertraege");
  await expect(
    page.getByRole("link", { name: /Wartung: Neue Website für das Café/ }),
  ).toBeVisible();
  await expectAccessible(page, "maintenance contract list");
  await page.goto("/aufgaben");
  await expect(
    page.getByText("Rechnung Wartung: Neue Website für das Café freigeben").first(),
  ).toBeVisible();

  // Deletion request with issued invoices: everything else goes, the invoices stay (ADR-0071).
  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  await page.getByRole("tab", { name: "Stammdaten" }).click();
  const privacy = page.locator("#datenschutz");
  await privacy.getByText("Daten löschen, Rechnungen behalten …").click();
  await privacy.getByRole("button", { name: "Daten löschen", exact: true }).click();
  await expect(page.getByRole("status").getByText(/Daten am .* gelöscht\./)).toBeVisible();
  await expect(page.getByText("Daten gelöscht", { exact: true })).toBeVisible();
  await expectAccessible(page, "restricted customer");
  if (shots) await privacy.screenshot({ path: `${shots}/restricted-customer.png` });
});
