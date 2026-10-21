import { expect, test } from "@playwright/test";
import { E2E } from "../../playwright.config";
import {
  acceptStatistics,
  consentNotice,
  createApiToken,
  expectAccessible,
  publishWithCli,
  signInWithWorkspace,
} from "./helpers";

/**
 * Phase 2 "done when": a scan shows up in the customer's timeline, and a
 * link preview is recorded as a bot but ignored.
 */

const port = new URL(E2E.baseURL).port;
const workspaceHost = `e2e-tracking.localhost:${port}`;
const WHATSAPP = "WhatsApp/2.23.20.0 A";

test.describe.configure({ mode: "serial" });

let shortUrl = "";
let qrUrl = "";

test("publishing prints the letter's short link and QR link", async ({ page }) => {
  test.setTimeout(180_000);
  await signInWithWorkspace(page, {
    email: "tracking@e2e.test",
    name: "Theo Tracking",
    workspace: "E2E Tracking",
    slug: "e2e-tracking",
  });
  const output = publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Tracking"));
  shortUrl = output.match(/Kurzlink:\s+(\S+)/)?.[1] ?? "";
  qrUrl = output.match(/QR-Link:\s+(\S+)/)?.[1] ?? "";
  expect(shortUrl, output).toMatch(new RegExp(`^http://${workspaceHost}/[a-z2-9]{4}$`));
  expect(qrUrl, output).toMatch(new RegExp(`^http://${workspaceHost}/[0-9A-Za-z]{12}$`));

  await page.goto("/kunden");
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText("Entwurf");
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText("Noch nicht geöffnet");
  await expectAccessible(page, "customer list");
});

test("a messenger link preview is recorded as a bot", async ({ request }) => {
  // Node cannot resolve *.localhost; address the server directly with the workspace host.
  const response = await request.get(new URL(qrUrl).pathname, {
    headers: { host: workspaceHost, "user-agent": WHATSAPP },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toMatch(/^\/x\/cafe-mueller-[a-z0-9]+\?v=/);
});

test("a prospect scans the QR code and reads the exposé", async ({ browser }) => {
  // A fresh context: the prospect's phone, no owner cookie.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await context.newPage();
  const started = phone.waitForResponse((r) => r.url().endsWith("/t/start") && r.ok());
  await phone.goto(qrUrl);
  await started;
  await expect(phone).toHaveURL(/\/x\/cafe-mueller-[a-z0-9]+$/); // ticket removed from the URL
  await expect(phone.getByRole("heading", { level: 1 })).toBeVisible();
  await acceptStatistics(phone);

  // Read the pricing section for more than three seconds, then leave.
  await phone.locator("section#preise").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(3_500);
  const flushed = phone.waitForRequest((r) => r.url().endsWith("/t/e"));
  await phone.locator("section#kontakt").scrollIntoViewIfNeeded();
  await phone.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flushed;
  await context.close();
});

test("the owner sees the scan in the timeline, the bot only on request", async ({ page }) => {
  await signInWithWorkspace(page, {
    email: "tracking@e2e.test",
    name: "Theo Tracking",
    workspace: "E2E Tracking",
    slug: "e2e-tracking",
  });
  await page.goto("/kunden");
  const row = page.getByRole("row", { name: /Café Müller/ });
  await expect(row).toContainText("Geöffnet");
  await row.getByRole("link", { name: "Café Müller" }).click();

  await expect(page.getByText("Per QR-Code geöffnet")).toBeVisible();
  await expect(page.getByText(/„Was es kostet“ \d+ s gelesen/)).toBeVisible();
  await expect(page.getByText("Status: Geöffnet")).toBeVisible();
  await expect(page.getByText(/Link-Vorschau oder Bot/)).toHaveCount(0);
  await expectAccessible(page, "customer detail");

  await page.getByRole("link", { name: /1 Bot und Link-Vorschauen anzeigen/ }).click();
  await expect(page.getByText("Link-Vorschau oder Bot (WhatsApp-Vorschau)")).toBeVisible();

  await page.goto("/kunden/pipeline");
  await expect(page.getByRole("combobox", { name: "Status von Café Müller" })).toHaveValue(
    "opened",
  );
  await expectAccessible(page, "pipeline");
});

test("a mistyped short link offers the right one", async ({ page }) => {
  const code = new URL(shortUrl).pathname.slice(1);
  const typo = `${code.slice(0, 3)}${code[3] === "z" ? "y" : "z"}`;
  await page.goto(`http://${workspaceHost}/${typo.toUpperCase()}`);
  await expect(
    page.getByRole("heading", { name: "Diesen Link kennen wir leider nicht." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: code })).toHaveAttribute("href", `/${code}`);
  await expectAccessible(page, "short link not found");
});

test("without a „yes“ the exposé sends only the basis (ADR-0065)", async ({ browser }) => {
  test.setTimeout(90_000);
  const shots = process.env.SCREENSHOT_DIR;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await context.newPage();
  const sent: string[] = [];
  phone.on("request", (request) => {
    if (request.url().endsWith("/t/e")) sent.push(request.postData() ?? "");
  });
  await phone.goto(shortUrl);
  const notice = consentNotice(phone);
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice.getByRole("button", { name: "Ablehnen" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Auswählen" })).toBeVisible();
  await expect(notice.getByRole("button", { name: "Einverstanden" })).toBeVisible();
  if (shots) await phone.screenshot({ path: `${shots}/01-handy-hinweis.png` });
  await notice.getByRole("button", { name: "Auswählen" }).click();
  await expect(notice.getByLabel(/Lesestatistik/)).not.toBeChecked();
  if (shots) await phone.screenshot({ path: `${shots}/02-handy-auswahl.png` });
  await expectAccessible(phone, "consent switches");

  // Nothing ticked, saved: the same as „Ablehnen“.
  const answered = phone.waitForResponse((r) => r.url().endsWith("/t/consent"));
  await notice.getByRole("button", { name: "Auswahl speichern" }).click();
  expect((await answered).request().postDataJSON()).toMatchObject({
    scope: "statistics",
    decision: "denied",
  });
  await expect(notice).toBeHidden();

  await phone.locator("section#preise").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(3_500);
  await phone.locator("section#kontakt").scrollIntoViewIfNeeded();
  await phone.waitForTimeout(16_000); // past one heartbeat
  expect(sent.join("")).not.toMatch(/section_view|scroll_depth|heartbeat|section_dwell/);

  // The footer reopens the switches; the decision is remembered on reload.
  await phone.getByRole("button", { name: "Datenschutz-Einstellungen" }).click();
  await expect(notice.getByLabel(/Lesestatistik/)).not.toBeChecked();
  if (shots) await phone.screenshot({ path: `${shots}/03-handy-einstellungen.png` });
  await notice.getByRole("button", { name: "Hinweis schließen" }).click();
  await phone.reload();
  await expect(phone.getByRole("heading", { level: 1 })).toBeVisible();
  await phone.waitForTimeout(3_000);
  await expect(notice).toBeHidden();
  await context.close();

  // Global Privacy Control counts as „Ablehnen“: no notice at all.
  const gpc = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    extraHTTPHeaders: { "Sec-GPC": "1" },
  });
  const desktop = await gpc.newPage();
  const started = desktop.waitForResponse((r) => r.url().endsWith("/t/start") && r.ok());
  await desktop.goto(shortUrl);
  expect(await (await started).json()).toMatchObject({ consentNotice: false });
  await desktop.waitForTimeout(3_000);
  await expect(consentNotice(desktop)).toBeHidden();
  await gpc.close();

  // Desktop, ignored: reading works, the notice stays and asks again next time.
  const ignore = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const reader = await ignore.newPage();
  await reader.goto(shortUrl);
  await expect(consentNotice(reader)).toBeVisible({ timeout: 20_000 });
  if (shots) await reader.screenshot({ path: `${shots}/04-desktop-hinweis.png` });
  await expectAccessible(reader, "exposé with consent notice on desktop");
  await consentNotice(reader).getByRole("button", { name: "Hinweis schließen" }).click();
  await reader.reload();
  await expect(consentNotice(reader)).toBeVisible({ timeout: 20_000 });
  await ignore.close();
});
