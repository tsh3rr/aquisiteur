import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import {
  consentNotice,
  createApiToken,
  expectAccessible,
  publishWithCli,
  signInWithWorkspace,
} from "./helpers";

/**
 * Phase 5 "done when": a campaign runs from import to evaluation. The owner
 * imports prospects into a new campaign, prints the letter as PDF, marks it
 * as posted; the prospect opens the exposé on the phone and allows a
 * recording; the owner watches it and reads the dashboards, map and export.
 */

const port = new URL(E2E.baseURL).port;
const workspaceHost = `e2e-kampagne.localhost:${port}`;
const account = {
  email: "kampagne@e2e.test",
  name: "Karl Kampagne",
  workspace: "E2E Kampagne",
  slug: "e2e-kampagne",
};

test.describe.configure({ mode: "serial" });

let exposeUrl = "";
let campaignUrl = "";

async function owner(page: Page) {
  await signInWithWorkspace(page, account);
}

const CSV = [
  "Firma;Straße;PLZ;Ort;Branche;Ansprechpartner;E-Mail",
  "Café Müller;Gottschedstraße 7;04109;Leipzig;Gastronomie;Sabine Müller;kontakt@cafe-mueller.example",
  "Friseur Schnittig;Karl-Liebknecht-Str. 12;04107;Leipzig;Friseur;Tom Schnitt;tom@schnittig.example",
  "Blumen Rosa;Markt 3;04109;Leipzig;Einzelhandel;Rosa Blum;",
  ";ohne Firma;04109;Leipzig;;;",
].join("\n");

test("the owner imports prospects into a new campaign", async ({ page }) => {
  test.setTimeout(180_000);
  await owner(page);

  // Café Müller already exists with its exposé; the import must skip it.
  const output = publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Kampagne"));
  const path = output.match(/Öffentlich:\s+\S+(\/x\/\S+)/)?.[1];
  expect(path, output).toBeTruthy();
  exposeUrl = `http://${workspaceHost}${path}`;

  await page.goto("/kampagnen");
  await expect(page.getByText("Noch keine Kampagne.")).toBeVisible();
  await expectAccessible(page, "empty campaign list");

  await page.goto("/kunden/import");
  await page.getByLabel("CSV-Datei").setInputFiles({
    name: "kunden.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByText(/3 Zeilen bereit, 1 mit Fehlern/)).toBeVisible();
  await expectAccessible(page, "import preview");
  await page.getByLabel("Kampagne", { exact: true }).selectOption("new");
  await page.getByLabel("Name der neuen Kampagne").fill("Leipzig Herbst");
  await page.getByRole("button", { name: "3 importieren" }).click();
  await expect(page.getByText(/2 Kunden importiert/)).toBeVisible();
  await expect(page.getByText(/1 .*übersprungen/)).toBeVisible();

  // The existing customer joins the campaign through the list's bulk action.
  await page.goto("/kunden");
  await page.getByRole("checkbox", { name: "Café Müller auswählen" }).check();
  const bulk = page.getByRole("group", { name: "Sammelaktionen" });
  await bulk.getByLabel("Kampagne").selectOption({ label: "Leipzig Herbst" });
  await bulk.getByRole("button", { name: "Zuweisen" }).click();
  await expect(page.getByText("1 Kunde der Kampagne zugewiesen.")).toBeVisible();

  await page.goto("/kampagnen");
  await page.getByRole("link", { name: /Leipzig Herbst/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Leipzig Herbst" })).toBeVisible();
  campaignUrl = page.url();
  const members = page.getByRole("region", { name: "Kunden der Kampagne" });
  await expect(members).toContainText("Friseur Schnittig");
  await expect(members).toContainText("Café Müller");
  await expectAccessible(page, "campaign dashboard before sending");
});

test("letters are created, printed as PDF and marked as posted", async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  await page.goto(campaignUrl);
  await page.getByRole("link", { name: "Briefe für alle erstellen" }).click();
  // Only Café Müller has an exposé; the others are listed as skipped.
  await expect(page.getByText(/Friseur Schnittig/)).toBeVisible();
  await expectAccessible(page, "new letters");
  await page.getByRole("button", { name: "1 Brief erstellen" }).click();
  await expect(page.getByText(/1 Brief erstellt/)).toBeVisible();
  await expectAccessible(page, "letter list");

  const download = page.waitForEvent("download");
  await page
    .getByRole("group", { name: "Sammelaktionen" })
    .getByRole("button", { name: "PDF herunterladen" })
    .click();
  const file = await (await download).path();
  const pdf = readFileSync(file);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // Letter plus the exposé teaser page (ADR-0055), images included.
  expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
  expect(pdf.toString("latin1")).toContain("/Subtype /Image");
  // No sender address in this workspace yet, so the letter carries a hint.
  await expect(page.getByText(/^PDF erstellt\. 1 Brief hat Hinweise/)).toBeVisible();
  await (await download).saveAs("test-results/letter.pdf");

  // Posted yesterday, so today's visit counts as the opening.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  await page.getByLabel("Versanddatum").fill(yesterday);
  await page.getByRole("button", { name: "Als versendet markieren" }).click();
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText("Versendet");
});

test("the prospect allows a recording and the owner watches it", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await owner(page);
  await page.goto("/settings#aufzeichnung");
  const replay = page.locator("#aufzeichnung");
  await replay.getByLabel(/um Erlaubnis für eine Aufzeichnung bitten/).check();
  await replay.getByRole("button", { name: "Speichern" }).click();
  await expect(replay.getByText(/Besucher werden ab jetzt gefragt/)).toBeVisible();

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const phone = await phoneContext.newPage();
  await phone.goto(exposeUrl);
  const notice = consentNotice(phone);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expectAccessible(phone, "exposé with consent notice");
  await notice.getByRole("button", { name: "Auswählen" }).click();
  await expect(notice.getByLabel(/Lesestatistik/)).not.toBeChecked();
  await expect(notice.getByLabel(/Aufzeichnung/)).not.toBeChecked();
  await expectAccessible(phone, "exposé with consent switches");
  await notice.getByLabel(/Aufzeichnung/).check();
  const consent = phone.waitForResponse(
    (r) => r.url().endsWith("/t/consent") && r.request().postData()?.includes("replay") === true,
  );
  await notice.getByRole("button", { name: "Auswahl speichern" }).click();
  expect((await consent).status()).toBe(204);
  await expect(phone.getByRole("button", { name: /Aufzeichnung läuft/ })).toBeVisible();
  const uploaded = phone.waitForResponse((r) => r.url().endsWith("/t/replay"), {
    timeout: 30_000,
  });
  await phone.locator("section#preise").scrollIntoViewIfNeeded();
  await phone.mouse.wheel(0, 400);
  expect((await uploaded).status()).toBe(204);
  await phoneContext.close();

  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  await expect(page.getByText("Aufzeichnung erlaubt")).toBeVisible();
  await page.getByRole("link", { name: /Aufzeichnung ansehen/ }).click();
  await expect(page.getByRole("heading", { name: "Aufzeichnung des Besuchs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abspielen" })).toBeEnabled({ timeout: 20_000 });
  await expectAccessible(page, "replay viewer", { exclude: [".replayer-wrapper iframe"] });
});

test("the dashboards show the campaign from letter to visit", async ({ page }) => {
  test.setTimeout(120_000);
  await owner(page);
  // The visit came straight to the exposé address, as when someone types it from the letter.
  await page.goto("/briefe");
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText("nach");
  await page.goto("/auswertung");
  const tile = (label: string) => page.locator("dl > div").filter({ hasText: label });
  await expect(tile("Versendete Briefe").locator("dd").first()).toHaveText("1");
  await expect(tile("Öffnungsrate").locator("dd").first()).toHaveText("100 %");
  await expect(page.getByRole("list", { name: "Funnel aller Kunden" })).toContainText("Geöffnet");
  await expectAccessible(page, "overview dashboard");

  const csv = await page.request.get("/auswertung/export");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("Versendete Briefe");

  await page.getByRole("link", { name: "Inhalte" }).click();
  await expect(page.getByRole("heading", { name: "Abschnitte" })).toBeVisible();
  await expectAccessible(page, "content dashboard");

  await page.getByRole("link", { name: "Karte" }).click();
  await page.getByRole("button", { name: "Jetzt verorten" }).click();
  await expect(page.getByText(/3 Adressen gefunden/)).toBeVisible();
  await expect(page.getByText("Kunden auf der Karte als Liste (3)")).toBeVisible();
  await expect(page.locator(".leaflet-interactive")).toHaveCount(3);
  await expectAccessible(page, "map dashboard");

  await page.goto(campaignUrl);
  await expect(page.getByRole("list", { name: "Funnel aller Kunden" })).toContainText("Versendet");
  await expectAccessible(page, "campaign dashboard after sending");
});
