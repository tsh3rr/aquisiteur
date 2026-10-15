import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { E2E } from "../../playwright.config";
import { expectAccessible } from "./helpers";

/**
 * Phase 1 "done when": an exposé published with the CLI is reachable under
 * its workspace host, renders every interactive block accessibly, appears
 * in the cockpit with its versions, and lets the prospect opt out.
 */

const email = "exposes@e2e.test";
const workspaceHost = `http://e2e-agentur.localhost:${new URL(E2E.baseURL).port}`;

function run(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("pnpm", ["-s", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_URL: E2E.databaseUrl,
      APP_URL: E2E.baseURL,
      STORAGE_PROVIDER: "local",
      ...env,
    },
  });
}

/** Account + finished workspace via `pnpm user:login`, then sign in with its link. */
async function signIn(page: Page) {
  const output = run(
    ["user:login", email, "--name", "Erika E2E", "--workspace", "E2E Agentur"].concat([
      "--slug",
      "e2e-agentur",
    ]),
  );
  const link = output.match(/https?:\/\/\S+/)?.[0];
  expect(link, output).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(`${E2E.baseURL}/`);
}

test.describe.configure({ mode: "serial" });

let publicUrl = "";

test("owner creates an API token and publishes an exposé with the CLI", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);

  await page.goto("/exposes");
  await expect(page.getByRole("heading", { name: "Exposés" })).toBeVisible();
  await expectAccessible(page, "empty exposé list");

  await page.goto("/settings#api-tokens");
  await page.getByLabel("Name").fill("E2E CLI");
  await page.getByRole("button", { name: "Token anlegen" }).click();
  const token = (await page.getByText(/^aq_[0-9A-Za-z]{32}$/).textContent())?.trim() ?? "";
  expect(token).toMatch(/^aq_/);
  await expectAccessible(page, "settings with new token");

  const output = run(["expose:publish", "exposes/tischlerei-holzmann"], {
    AQUISITEUR_API_TOKEN: token,
    AQUISITEUR_API_URL: E2E.baseURL,
  });
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
});

test("the prospect can opt out, and the opt-out is recorded once", async ({ page }) => {
  await page.goto(publicUrl);
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
