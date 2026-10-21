import { expect, test } from "@playwright/test";
import { createApiToken, expectAccessible, publishWithCli, signInWithWorkspace } from "./helpers";

/**
 * §7.8 Aufgaben & Wiedervorlagen: the owner adds a follow-up on the customer
 * page, sees it under „Heute“, moves it to tomorrow, finds it in the task
 * list and ticks it off.
 */

const account = {
  email: "aufgaben@e2e.test",
  name: "Anna Aufgabe",
  workspace: "E2E Aufgaben",
  slug: "e2e-aufgaben",
};

test("a follow-up goes from the customer page to „Heute“ and the task list", async ({ page }) => {
  test.setTimeout(120_000);
  await signInWithWorkspace(page, account);
  publishWithCli("exposes/cafe-mueller", await createApiToken(page, "Aufgaben"));

  await page.goto("/kunden");
  await page.getByRole("link", { name: "Café Müller" }).first().click();
  const card = page.locator("#aufgaben");
  await expect(card.getByText("Keine offene Aufgabe.")).toBeVisible();
  await card.getByRole("button", { name: "Aufgabe hinzufügen" }).click();
  await card.getByLabel("Aufgabe", { exact: true }).fill("Frau Müller anrufen");
  await card.getByRole("button", { name: "Heute" }).click();
  await expect(card.getByRole("button", { name: "Heute" })).toHaveAttribute("aria-pressed", "true");
  await card.getByLabel("Uhrzeit").fill("23:59");
  await expect(card.getByLabel("Erinnerung")).toHaveValue("at_due");
  await expectAccessible(page, "customer page with the task form");
  await card.getByRole("button", { name: "Anlegen" }).click();

  const item = card.getByRole("listitem").filter({ hasText: "Frau Müller anrufen" });
  await expect(item).toBeVisible();
  await expect(item).toContainText("heute 23:59");
  await expect(item).toHaveAttribute("id", /^aufgabe-/);

  await page.goto("/");
  const followUps = page.getByRole("region", { name: "Wiedervorlagen" });
  const today = followUps.getByRole("listitem").filter({ hasText: "Frau Müller anrufen" });
  await expect(today.getByRole("link", { name: "Café Müller" })).toBeVisible();
  await expectAccessible(page, "Heute with follow-ups");
  await today
    .getByRole("button", { name: /Morgen/ })
    .first()
    .click();
  await expect(followUps.getByText("Heute ist nichts fällig.")).toBeVisible();

  await page.goto("/aufgaben");
  const upcoming = page.getByRole("region", { name: "Demnächst" });
  const moved = upcoming.getByRole("listitem").filter({ hasText: "Frau Müller anrufen" });
  await expect(moved).toContainText("morgen 23:59");
  await expectAccessible(page, "task list");

  const done = moved.getByRole("button", { name: "Erledigt: Frau Müller anrufen" });
  await done.click();
  // The done task leaves the open list as soon as the page revalidates.
  await expect(page.getByText("Keine offenen Aufgaben.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Keine offenen Aufgaben.")).toBeVisible();
  await page.getByText(/Erledigt in den letzten 14 Tagen/).click();
  await expect(page.getByRole("button", { name: "Erledigt: Frau Müller anrufen" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the follow-up rule is set under Einstellungen → Briefe", async ({ page }) => {
  await signInWithWorkspace(page, {
    email: "folgebrief@e2e.test",
    name: "Fritz Folgebrief",
    workspace: "E2E Folgebrief",
    slug: "e2e-folgebrief",
  });
  await page.goto("/settings#briefe");
  const letters = page.locator("#briefe");
  const toggle = letters.getByLabel("Folgebrief automatisch vorbereiten");
  await expect(toggle).toBeChecked();
  const days = letters.getByLabel("Tage nach dem ersten Brief");
  await expect(days).toHaveValue("14");
  await days.fill("10");
  await toggle.uncheck();
  await letters.getByRole("button", { name: "Speichern" }).click();
  await expect(letters.getByText("Gespeichert.")).toBeVisible();
  await expectAccessible(page, "letter settings with follow-ups");

  await page.reload();
  await expect(letters.getByLabel("Tage nach dem ersten Brief")).toHaveValue("10");
  await expect(letters.getByLabel("Folgebrief automatisch vorbereiten")).not.toBeChecked();
});
