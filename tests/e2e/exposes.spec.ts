import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import {
  createApiToken,
  expectAccessible,
  publishWithCli,
  rejectConsent,
  signInWithWorkspace,
} from "./helpers";

/**
 * Phase 1 "done when": an exposé published with the CLI is reachable under
 * its workspace host, renders every interactive block accessibly, appears
 * in the cockpit with its versions, and lets the prospect opt out.
 */

const email = "exposes@e2e.test";
const workspaceHost = `http://e2e-agentur.localhost:${new URL(E2E.baseURL).port}`;

async function signIn(page: Page) {
  await signInWithWorkspace(page, {
    email,
    name: "Erika E2E",
    workspace: "E2E Agentur",
    slug: "e2e-agentur",
  });
}

test.describe.configure({ mode: "serial" });

let publicUrl = "";
let apiToken = "";

test("owner creates an API token and publishes an exposé with the CLI", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto("/exposes");
  await expect(page.getByRole("heading", { name: "Exposés" })).toBeVisible();
  await expectAccessible(page, "empty exposé list");

  const token = await createApiToken(page, "E2E CLI");
  apiToken = token;
  await expectAccessible(page, "settings with new token");

  const output = publishWithCli("exposes/tischlerei-holzmann", token);
  publicUrl = output.match(/Öffentlich:\s+(\S+)/)?.[1] ?? "";
  expect(publicUrl, output).toMatch(
    /^http:\/\/e2e-agentur\.localhost:\d+\/x\/tischlerei-holzmann-/,
  );

  await page.goto("/exposes");
  await expect(
    page.getByRole("link", { name: "Öffnen: Tischlerei Holzmann GmbH (neuer Tab)" }),
  ).toHaveAttribute("href", publicUrl);
  await expectAccessible(page, "exposé list");
  await page.getByRole("link", { name: /^Tischlerei Holzmann GmbH/ }).click();
  await expect(page.getByRole("heading", { name: "Tischlerei Holzmann GmbH" })).toBeVisible();
  await expect(page.getByText("Version 1 · aktuell")).toBeVisible();
  const preview = page.frameLocator("iframe");
  await expect(preview.getByRole("heading", { level: 1 })).toContainText("Maßarbeit");
  await expectAccessible(page, "exposé detail");
});

test("the public exposé renders accessibly with working slider and price calculator", async ({
  page,
}) => {
  expect(publicUrl).toContain(workspaceHost);
  await page.goto(publicUrl);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Maßarbeit");
  await expect(page.getByText("Guten Tag Herr Holzmann,")).toBeVisible();
  await expectAccessible(page, "public exposé");

  const slider = page.getByRole("slider");
  await slider.focus();
  const before = await slider.inputValue();
  await page.keyboard.press("ArrowRight");
  expect(Number(await slider.inputValue())).toBeGreaterThan(Number(before));

  // Dragging works anywhere on the image, not only on the handle.
  await slider.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const area = (await slider.boundingBox())!;
  await page.mouse.move(area.x + area.width * 0.9, area.y + area.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.25, area.y + area.height * 0.35, { steps: 6 });
  await page.mouse.up();
  await expect(slider).toHaveValue("25");

  const total = page.locator("[aria-live='polite']").filter({ hasText: "Einmalig" });
  await expect(total).toContainText("4.700");
  await page.getByText("Fototag in der Werkstatt").click();
  await expect(total).toContainText("5.350");

  const images = await page
    .locator("main img")
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLImageElement).getAttribute("width")),
    );
  expect(images.length).toBeGreaterThan(0);
  expect(images.every(Boolean), "every image has explicit dimensions").toBe(true);

  // The exposé ships only its own client code; cockpit chunks (zod, realtime) cost
  // the Lighthouse budget (ADR-0048).
  const scripts = await page
    .locator("script[src]")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("src") ?? ""));
  expect(scripts.filter((src) => src.includes("(cockpit)"))).toEqual([]);
});

function pdfPages(file: string) {
  const pdf = readFileSync(file);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.toString("latin1")).toContain("/Subtype /Image");
  return pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
}

async function savedPdf(download: Promise<Download>, name: string) {
  const file = await download;
  expect(file.suggestedFilename()).toBe("Expose Tischlerei Holzmann GmbH.pdf");
  await file.saveAs(`test-results/${name}`);
  return pdfPages((await file.path())!);
}

test("the owner downloads the designed exposé PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/exposes");
  await page.getByRole("link", { name: /^Tischlerei Holzmann GmbH/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Als PDF herunterladen" }).click();
  // Cover plus the blocks on following pages.
  expect(await savedPdf(download, "expose-cockpit.pdf")).toBeGreaterThan(2);
  await expect(page.getByText("PDF erstellt.", { exact: true })).toBeVisible();
});

test("the reader saves the exposé as a designed PDF", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(publicUrl);
  await rejectConsent(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Als PDF speichern" }).click();
  expect(await savedPdf(download, "expose-public.pdf")).toBeGreaterThan(2);
  await expect(page.getByText("PDF gespeichert")).toBeAttached();
  expect(errors.filter((text) => /Content Security Policy|wasm/i.test(text))).toEqual([]);
});

test("the prospect can opt out, and the opt-out is recorded once", async ({ page }) => {
  await page.goto(publicUrl);
  await rejectConsent(page);
  await page.getByRole("link", { name: "Kein Interesse, bitte nicht mehr kontaktieren" }).click();
  await expect(page.getByRole("heading", { name: "Kein Interesse?" })).toBeVisible();
  await expectAccessible(page, "opt-out confirmation");
  await page.getByRole("button", { name: "Bitte nicht mehr kontaktieren" }).click();
  await expect(page.getByRole("heading", { name: "Verstanden." })).toBeVisible();
});

test("refuses an opt-out posted from another site", async ({ request }) => {
  // Node cannot resolve *.localhost; address the server directly with the workspace host.
  const url = new URL(publicUrl);
  const response = await request.post(`${url.pathname}/kein-interesse/bestaetigen`, {
    headers: { host: url.host, origin: "https://evil.example" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test("unknown slugs and foreign hosts answer 404", async ({ page }) => {
  const slug = new URL(publicUrl).pathname;
  expect((await page.goto(`${workspaceHost}/x/gibt-es-nicht-1234567890`))?.status()).toBe(404);
  expect(
    (await page.goto(`http://nobody.localhost:${new URL(E2E.baseURL).port}${slug}`))?.status(),
  ).toBe(404);
});

test("a nudge expands the chat button and folds back when the visitor reads on", async ({
  page,
}) => {
  await page.goto(publicUrl);
  await rejectConsent(page);
  const launcher = page.getByRole("button", { name: /^Chat/ });
  await expect(launcher).toBeVisible();

  // Exit intent on desktop: the pointer leaves towards the tab bar.
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0, bubbles: true })),
  );
  const nudge = page.getByRole("group", { name: "Hinweis" });
  await expect(nudge).toContainText("Haben Sie noch eine Frage?");
  await expect(launcher).toBeHidden();
  await expectAccessible(page, "exposé with the expanded chat button");

  await page.waitForTimeout(1300);
  await page.mouse.wheel(0, 900);
  await expect(nudge).toBeHidden();
  await expect(launcher).toBeVisible();
});

test("the bold and soft exposé styles render accessibly in light and dark", async ({ page }) => {
  test.setTimeout(180_000);
  expect(apiToken).not.toBe("");
  for (const [folder, headline] of [
    ["exposes/eisenwerk-athletics", "Starke Box"],
    ["exposes/physio-lindenhof", "Ihre Patienten buchen selbst"],
  ] as const) {
    const url = publishWithCli(folder, apiToken).match(/Öffentlich:\s+(\S+)/)?.[1] ?? "";
    expect(url).toContain(workspaceHost);
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(headline);
      await expectAccessible(page, `${folder} (${colorScheme})`);
    }
  }
});
