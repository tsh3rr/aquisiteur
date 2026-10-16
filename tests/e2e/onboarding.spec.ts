import { expect, test } from "@playwright/test";
import { expectAccessible, latestMagicLink, mailCount } from "./helpers";

/**
 * Phase 0 "done when": the owner creates their workspace with the wizard and
 * lands in an empty cockpit. Every screen on the way is checked with axe.
 */
test("owner signs in, runs the wizard, registers a passkey and sees the empty cockpit", async ({
  page,
  context,
}) => {
  const email = "owner@e2e.test";

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Willkommen zurück" })).toBeVisible();
  await expectAccessible(page, "login");

  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmeldelink senden" }).click();
  await expect(page.getByText("Prüfen Sie Ihr Postfach.")).toBeVisible();

  await page.goto(await latestMagicLink(email));
  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole("heading", { name: "Ihr Workspace" })).toBeVisible();
  await expectAccessible(page, "onboarding step 1");

  // Step 1: workspace, slug follows the name.
  await page.getByLabel("Name Ihrer Agentur").fill("Pixelwerk Leipzig");
  await expect(page.getByLabel("Adresse")).toHaveValue("pixelwerk-leipzig");
  await page.getByRole("button", { name: "Weiter" }).click();

  // Step 2: validation errors are announced and linked to their fields.
  await expect(
    page.getByRole("heading", { name: "Wie Interessenten Sie erreichen" }),
  ).toBeVisible();
  await page.getByLabel("Ihr Name").fill("J");
  await page.getByLabel("Telefon").fill("abc");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByText("Bitte prüfen Sie die 2 markierten Felder.")).toBeVisible();
  await expect(page.getByLabel("Ihr Name")).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page, "onboarding step 2 with errors");
  await page.getByLabel("Ihr Name").fill("Jeremiasz Kapek");
  await page.getByLabel("Telefon").fill("0341 1234567");
  await page.getByLabel("WhatsApp-Nummer").fill("+49 170 1234567");
  await page.getByRole("button", { name: "Weiter" }).click();

  // Step 3: sender address and optional custom domain.
  await expect(
    page.getByRole("heading", { name: "Absender und Adresse Ihrer Exposés" }),
  ).toBeVisible();
  await page.getByLabel("Straße und Hausnummer").fill("Karl-Liebknecht-Str. 1");
  await page.getByLabel("PLZ", { exact: true }).fill("04107");
  await page.getByLabel("Ort", { exact: true }).fill("Leipzig");
  await page.getByLabel("Eigene Domain für Kurzlinks").fill("go.pixelwerk.test");
  await expectAccessible(page, "onboarding step 3");
  await page.getByRole("button", { name: "Weiter" }).click();

  // Step 4: passkey via a virtual authenticator.
  await expect(page.getByRole("heading", { name: "Schneller anmelden mit Passkey" })).toBeVisible();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  await expectAccessible(page, "onboarding step 4");
  await page.getByRole("button", { name: "Passkey für dieses Gerät anlegen" }).click();
  await expect(page.getByText("Passkey gespeichert.")).toBeVisible();
  await page.getByRole("button", { name: "Zum Cockpit" }).click();

  // Empty cockpit.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Hallo Jeremiasz." })).toBeVisible();
  await expect(page.getByText("Noch ist es ruhig in Pixelwerk Leipzig.")).toBeVisible();
  await expectAccessible(page, "cockpit today");

  await page.getByRole("link", { name: "Einstellungen" }).first().click();
  await expect(page.getByText("pixelwerk-leipzig.localhost")).toBeVisible();
  await expect(page.getByText("go.pixelwerk.test")).toBeVisible();
  await expect(page.getByText("Einrichtung offen")).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "angelegt am" })).toHaveCount(1);
  await expectAccessible(page, "settings");

  await page.getByRole("link", { name: "Design-System" }).first().click();
  await expect(page.getByRole("heading", { name: "Kontraste (WCAG 2.2 AA)" })).toBeVisible();
  await expectAccessible(page, "design system");

  // Dark mode stays accessible too.
  await page.getByRole("radio", { name: "Dunkel" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectAccessible(page, "design system (dark)");

  // Sign out, then sign back in with the passkey only.
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL(/\/login$/);
  const mailsBefore = mailCount(email);
  // The login page offers saved passkeys via conditional UI, and the virtual
  // authenticator may answer that request by itself. Either path signs in.
  const greeting = page.getByRole("heading", { name: "Hallo Jeremiasz." });
  const passkeyButton = page.getByRole("button", { name: "Mit Passkey anmelden" });
  await expect(greeting.or(passkeyButton)).toBeVisible();
  if (await passkeyButton.isVisible()) {
    await passkeyButton.click({ timeout: 5_000 }).catch(() => {
      // Detached because the conditional request already signed in.
    });
  }
  await expect(greeting).toBeVisible();
  expect(mailCount(email)).toBe(mailsBefore);
});

test("non-allow-listed emails get the same answer but no mail", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill("stranger@e2e.test");
  await page.getByRole("button", { name: "Anmeldelink senden" }).click();
  await expect(page.getByText("Prüfen Sie Ihr Postfach.")).toBeVisible();
  expect(mailCount("stranger@e2e.test")).toBe(0);
});

test("the workspace is reachable on its platform subdomain, unknown hosts are not", async ({
  request,
}) => {
  const known = await request.get("/", { headers: { host: "pixelwerk-leipzig.localhost:3100" } });
  expect(known.status()).toBe(200);
  expect(await known.text()).toContain("Pixelwerk Leipzig");
  expect(known.headers()["x-robots-tag"]).toBe("noindex, nofollow");

  const unknown = await request.get("/", { headers: { host: "nobody.localhost:3100" } });
  expect(unknown.status()).toBe(404);

  // Cockpit-only routes are not reachable through a workspace host.
  const api = await request.get("/api/auth/ok", {
    headers: { host: "pixelwerk-leipzig.localhost:3100" },
  });
  expect(api.status()).toBe(404);
});

test("cockpit responses carry the security headers", async ({ request }) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
});

test("the health check answers on any host, as the server's deployment calls it", async ({
  request,
}) => {
  for (const host of ["localhost:3100", "nobody.localhost:3100"]) {
    const response = await request.get("/healthz", { headers: { host } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe("ok");
  }
});
