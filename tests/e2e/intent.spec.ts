import { existsSync, readFileSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "../../playwright.config";
import {
  createApiToken,
  expectAccessible,
  mailCount,
  publishWithCli,
  signInWithWorkspace,
} from "./helpers";

/**
 * Phase 4 "done when": QR open → read → typing in the chat → the owner sees
 * the score and the notification, live, plus push and e-mail going out.
 * The push goes to the log adapter here (no push service in CI); a real
 * phone is checked after the deploy.
 */

const port = new URL(E2E.baseURL).port;
const workspaceHost = `e2e-intent.localhost:${port}`;
const account = {
  email: "intent@e2e.test",
  name: "Ida Intent",
  workspace: "E2E Intent",
  slug: "e2e-intent",
};
const ENDPOINT = "https://push.example.test/e2e-intent";

test.describe.configure({ mode: "serial" });

let qrUrl = "";

async function owner(page: Page) {
  await signInWithWorkspace(page, account);
}

function pushes(): { endpoint: string; title: string; body: string; url: string }[] {
  if (!existsSync(E2E.pushLog)) return [];
  return readFileSync(E2E.pushLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((push) => push.endpoint === ENDPOINT);
}

test("the owner publishes an exposé and has a phone registered for push", async ({ page }) => {
  test.setTimeout(180_000);
  await owner(page);
  const output = publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Intent"));
  qrUrl = output.match(/QR-Link:\s+(\S+)/)?.[1] ?? "";
  expect(qrUrl, output).toMatch(new RegExp(`^http://${workspaceHost}/`));

  // A browser in CI cannot reach a push service; register the phone directly.
  const sql = postgres(E2E.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`
      insert into push_subscriptions (workspace_id, user_id, endpoint, p256dh, auth, label)
      select w.id, u.id, ${ENDPOINT}, 'key', 'auth', 'Chrome auf Android'
      from workspaces w, users u where w.slug = ${account.slug} and u.email = ${account.email}`;
  } finally {
    await sql.end();
  }

  // The token was created on /settings; a hash-only goto would not reload the page.
  await page.goto("/benachrichtigungen");
  await expect(page.getByText("Noch keine Benachrichtigungen.")).toBeVisible();
  await expectAccessible(page, "empty notifications");
  await page.goto("/settings#benachrichtigungen");
  const section = page.locator("#benachrichtigungen");
  await expect(section.getByText("Chrome auf Android")).toBeVisible();
  await expect(section.getByText("Erster echter Scan → Push")).toBeVisible();
  await expect(section.getByText("Score ab 50 % → Push und E-Mail")).toBeVisible();
  await expect(section.getByText("Rückrufwunsch → Push", { exact: true })).toBeVisible();

  // Add a rule with quiet hours, then remove it again.
  await section.getByRole("button", { name: "Regel hinzufügen" }).click();
  const form = section.getByRole("form", { name: "Neue Regel" });
  await form.getByLabel("Ereignis").selectOption("return_visit");
  await form.getByRole("checkbox", { name: "E-Mail" }).check();
  await form.getByLabel(/Ruhezeit von/).fill("22:00");
  await form.getByLabel(/Ruhezeit bis/).fill("07:00");
  await form.getByRole("button", { name: "Regel hinzufügen" }).click();
  await expect(section.getByText("Regel hinzugefügt.")).toBeVisible();
  await expect(
    section.getByText("Wiederholter Besuch → Push und E-Mail (Ruhezeit 22:00–07:00)"),
  ).toBeVisible();
  await expectAccessible(page, "notification settings");
  await section.getByRole("button", { name: "Wiederholter Besuch löschen" }).click();
  await expect(section.getByText("Regel gelöscht.")).toBeVisible();
});

test("QR open → read → typing: the owner sees score and notification live", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await owner(page);
  await page.goto("/");
  const reaction = page.locator("section", {
    has: page.getByRole("heading", { name: "Braucht jetzt eine Reaktion" }),
  });

  // The prospect's Android phone, without the owner's cookie.
  const phoneContext = await browser.newContext({ ...devices["Pixel 7"] });
  const phone = await phoneContext.newPage();
  const started = phone.waitForResponse((r) => r.url().endsWith("/t/start") && r.ok());
  await phone.goto(qrUrl);
  await started;

  // The first real scan: a push to the phone and an entry in the cockpit.
  await expect.poll(() => pushes().map((p) => p.title)).toContain("Café Müller · Exposé geöffnet");
  expect(pushes()[0]!.body).toMatch(/^QR-Code · Smartphone/);
  await expect(
    page.getByRole("link", { name: /^Benachrichtigungen \(1 neu\)/ }).first(),
  ).toBeAttached();
  // Live feed: what the prospect is doing right now.
  await expect(page.getByText("öffnet das Exposé").first()).toBeVisible();

  // Reads to the end (≥ 75 %), sent with the next heartbeat.
  await phone.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await phone.waitForResponse((r) => r.url().endsWith("/t/e") && r.ok(), { timeout: 30_000 });

  // Opens the chat and types a long message without sending it.
  const mailsBefore = mailCount(account.email);
  await phone.getByRole("button", { name: /^Live-Chat/ }).click();
  const chat = phone.getByRole("dialog", { name: /Chat mit/ });
  await expect(chat).toBeVisible();
  await chat.getByLabel("Ihre Nachricht").pressSequentially("Was würde eine neue Website kosten", {
    delay: 20,
  });

  // Live on „Heute“: score, explanation, recommendation and one-click actions.
  const card = reaction.getByTestId("intent-summary").filter({ hasText: "Café Müller" });
  await expect(card).toContainText(/\d+ % – (sehr )?wahrscheinlicher Kontaktversuch\./, {
    timeout: 20_000,
  });
  await expect(card).toContainText("im Chat");
  await expect(card).toContainText("Empfehlung:");
  await expect(card.getByRole("img", { name: /^Kontaktabsicht \d+ %/ })).toBeVisible();
  await expectAccessible(page, "today with intent");

  // Push and e-mail for the threshold.
  await expect
    .poll(() => pushes().map((p) => p.title))
    .toContainEqual(expect.stringMatching(/^Café Müller · \d+ % – /));
  await expect.poll(() => mailCount(account.email)).toBe(mailsBefore + 1);
  await phoneContext.close();

  // The list: both notifications, marked new until opened.
  await page
    .getByRole("link", { name: /^Benachrichtigungen \(2 neu\)/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "Benachrichtigungen", level: 1 })).toBeVisible();
  const list = page.getByRole("list", { name: "Benachrichtigungen, neueste zuerst" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(list.getByRole("listitem").first()).toContainText(/Café Müller · \d+ %/);
  await expect(list.getByRole("listitem").first()).toContainText("Push gesendet");
  await expect(list.getByRole("listitem").first()).toContainText("E-Mail gesendet");
  await expect(list.getByRole("listitem").nth(1)).toContainText("Café Müller · Exposé geöffnet");
  await expectAccessible(page, "notifications");

  // The customer page explains the score; the list sorts by it.
  await list.getByRole("listitem").first().getByRole("link").click();
  await expect(page.getByRole("heading", { name: "Café Müller", level: 1 })).toBeVisible();
  await expect(page.getByTestId("intent-summary")).toContainText("Empfehlung:");
  await page.getByText("Woraus sich der Score ergibt").click();
  await expect(page.getByText("Mindestens 2 Minuten oder 75 % gelesen")).toBeVisible();
  await expectAccessible(page, "customer with intent");

  await page.goto("/kunden?sort=score");
  await expect(page.getByRole("row", { name: /Café Müller/ })).toContainText(/\d+ %/);
});
