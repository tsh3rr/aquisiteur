import { expect, test } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

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
