import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * Phase 3 "done when": the chat works phone ↔ cockpit in real time. The
 * prospect reacts to the pricing nudge on a phone, the owner sees the
 * message arrive live in the cockpit and answers, the phone gets the answer
 * live, the owner hands over to WhatsApp. Plus the callback form.
 */

const port = new URL(E2E.baseURL).port;
const workspaceHost = `e2e-chat.localhost:${port}`;
const account = {
  email: "chat@e2e.test",
  name: "Clara Chat",
  workspace: "E2E Chat",
  slug: "e2e-chat",
};

test.describe.configure({ mode: "serial" });

let exposeUrl = "";

async function owner(page: Page) {
  await signInWithWorkspace(page, account);
}

test("the owner sets up contact channels and publishes an exposé", async ({ page }) => {
  test.setTimeout(180_000);
  await owner(page);
  await page.goto("/settings#kontakt");
  const contact = page.locator("#kontakt");
  await contact.getByLabel("WhatsApp").fill("+49 170 1234567");
  await contact.getByRole("textbox", { name: /^Telefon/ }).fill("+49 341 1234567");
  await contact.getByRole("button", { name: "Speichern" }).click();
  await expect(contact.getByText(/^Gespeichert\./)).toBeVisible();
  await expectAccessible(page, "settings with contact and chat");

  const output = publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Chat"));
  const path = output.match(/Öffentlich:\s+\S+(\/x\/\S+)/)?.[1];
  expect(path, output).toBeTruthy();
  exposeUrl = `http://${workspaceHost}${path}`;

  await page.goto("/chat");
  await expect(page.getByText("Noch keine Chats.")).toBeVisible();
  await expectAccessible(page, "empty chat inbox");
});

test("phone and cockpit chat in real time", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // The owner keeps the inbox open: the conversation must appear without reloading.
  await owner(page);
  await page.goto("/chat");
  await expect(page.getByRole("radio", { name: /Automatisch/ })).toBeChecked();

  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const phone = await phoneContext.newPage();
  const started = phone.waitForResponse((r) => r.url().endsWith("/t/start") && r.ok());
  await phone.goto(exposeUrl);
  await started;

  // Choosing a price option brings the offer nudge (polite, not modal).
  await phone.locator("section#preise").scrollIntoViewIfNeeded();
  await phone.locator("section#preise").getByText("Online-Reservierung", { exact: true }).click();
  const nudge = phone.getByRole("group", { name: "Hinweis" });
  await expect(nudge).toContainText("konkretes Angebot für diese Auswahl");
  await expectAccessible(phone, "exposé with nudge");
  await nudge.getByRole("button", { name: "Angebot anfragen" }).click();

  const chat = phone.getByRole("dialog", { name: /Chat mit/ });
  await expect(chat).toBeVisible();
  const field = chat.getByLabel("Ihre Nachricht");
  await expect(field).toHaveValue(
    "Bitte schicken Sie mir ein konkretes Angebot für: Neue Website, Google-Profil auffrischen, Online-Reservierung.",
  );
  await expectAccessible(phone, "chat panel");
  await chat.getByRole("button", { name: "Senden" }).click();
  await expect(chat.getByRole("log")).toContainText("konkretes Angebot");

  // Live in the cockpit: the inbox refreshes and the nav counts it.
  const thread = page.getByRole("link", { name: /Café Müller/ });
  await expect(thread).toContainText("1 neu");
  await expect(page.getByRole("link", { name: /^Chat\W+1 neue Anfrage/ }).first()).toBeVisible();
  // The thread view marks the chat read once hydrated; its live listener is attached by then.
  const hydrated = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/chat/"),
  );
  await thread.click();
  await expect(page.getByRole("heading", { name: "Chat mit Café Müller" })).toBeVisible();
  await hydrated;
  await expectAccessible(page, "chat thread");

  // Visitor types: nothing shows live in the cockpit until it is sent (ADR-0065).
  await chat.getByLabel("Ihre Nachricht").fill("Ab wann könnten Sie");
  await chat.getByLabel("Ihre Nachricht").fill("Ab wann könnten Sie starten?");
  await chat.getByLabel("Ihre Nachricht").press("Enter");
  await expect(page.getByRole("log")).toContainText("Ab wann könnten Sie starten?");

  // Owner answers; the phone gets it live, with the typing indicator first.
  await page.getByLabel("Antwort").fill("Gern ab nächster Woche.");
  await expect(chat.getByText(/schreibt …/)).toBeVisible();
  await page.getByLabel("Antwort").press("Enter");
  await expect(chat.getByRole("log")).toContainText("Gern ab nächster Woche.");

  // The widget asks for a return channel after the first message.
  await chat.getByRole("radio", { name: "WhatsApp" }).check();
  await chat.getByLabel("Name").fill("Sabine Müller");
  await chat.getByLabel("Handynummer").fill("0170 7654321");
  await chat.getByRole("button", { name: "Speichern" }).click();
  await expect(chat.getByText(/so erreiche ich Sie auch/)).toBeVisible();
  await expect(page.getByText("Sabine Müller möchte per")).toBeVisible();

  // Handover to WhatsApp.
  await page.getByRole("button", { name: "Auf WhatsApp weitermachen" }).click();
  const handover = chat.getByRole("link", { name: "Auf WhatsApp weiterschreiben" });
  await expect(handover).toHaveAttribute("href", /^https:\/\/wa\.me\/491701234567\?text=/);

  // A reload keeps the conversation (thread token in sessionStorage, this tab only).
  await phone.reload();
  await phone.getByRole("button", { name: /^Chat/ }).first().click();
  await expect(phone.getByRole("dialog", { name: /Chat mit/ }).getByRole("log")).toContainText(
    "Gern ab nächster Woche.",
  );
  await phoneContext.close();

  await page.goto("/kunden");
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText("Kontakt");
});

test("a callback request reaches the owner's day", async ({ page, browser }) => {
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  await phone.goto(exposeUrl);
  await phone.locator("section#kontakt").scrollIntoViewIfNeeded();
  await phone.getByRole("button", { name: /Rückruf anfordern/ }).click();
  await phone.getByRole("button", { name: "Rückruf anfordern", exact: true }).click();
  await expect(phone.getByText("Bitte prüfen Sie die markierten Felder.")).toBeVisible();
  await phone.getByLabel("Ihr Name").fill("Sabine Müller");
  // The number from the customer record is offered masked; the page never holds it in full.
  expect(await phone.content()).not.toContain("9876543");
  await phone.getByRole("button", { name: "+49 341 ••• 43 verwenden?" }).click();
  await expect(phone.getByLabel("Telefonnummer")).toHaveValue("+49 341 ••• 43");
  await expect(phone.getByLabel("Telefonnummer")).toBeFocused();
  await phone.getByRole("button", { name: "Andere Nummer eingeben" }).click();
  await expect(phone.getByRole("textbox", { name: "Telefonnummer" })).toBeFocused();
  await phone.getByRole("button", { name: "+49 341 ••• 43 verwenden?" }).click();
  await phone.getByLabel(/Wann passt es Ihnen/).fill("Dienstag ab 15 Uhr");
  await phone.getByRole("button", { name: "Rückruf anfordern", exact: true }).click();
  await expect(phone.getByText("Danke! Ich rufe Sie zu Ihrer Wunschzeit an.")).toBeVisible();
  await expectAccessible(phone, "contact block with callback form");
  await phoneContext.close();

  await owner(page);
  await expect(page.getByText("Wunschzeit: Dienstag ab 15 Uhr", { exact: true })).toBeVisible();
  await expect(page.getByText(/\+49 341 9876543/).first()).toBeVisible();
  await expectAccessible(page, "today with a callback");
  await page.getByRole("button", { name: /Erledigt\W+Rückruf für Sabine Müller/ }).click();
  await expect(page.getByText("Wunschzeit: Dienstag ab 15 Uhr", { exact: true })).toHaveCount(0);
});
