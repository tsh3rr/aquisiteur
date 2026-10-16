import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E } from "../../playwright.config";

/** Asserts zero axe violations against WCAG 2.2 A/AA (§8). */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

/** Latest magic link sent to `email` by the log mail adapter. */
export async function latestMagicLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const lines = readFileSync(E2E.mailLog, "utf8").trim().split("\n").filter(Boolean);
        const mails = lines.map((line) => JSON.parse(line) as { to: string; text: string });
        link = mails
          .filter((mail) => mail.to === email)
          .at(-1)
          ?.text.match(/https?:\/\/\S+/)?.[0];
        return link;
      },
      { message: `magic link for ${email}` },
    )
    .toBeTruthy();
  return link!;
}

export function mailCount(email: string): number {
  return readFileSync(E2E.mailLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => (JSON.parse(line) as { to: string }).to === email).length;
}

/** Runs a pnpm script against the E2E database, e.g. `user:login` or `expose:publish`. */
export function cli(args: string[], env: Record<string, string> = {}): string {
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
export async function signInWithWorkspace(
  page: Page,
  account: { email: string; name: string; workspace: string; slug: string },
) {
  const output = cli([
    "user:login",
    account.email,
    "--name",
    account.name,
    "--workspace",
    account.workspace,
    "--slug",
    account.slug,
  ]);
  const link = output.match(/https?:\/\/\S+/)?.[0];
  expect(link, output).toBeTruthy();
  await resetAuthRateLimits();
  await page.goto(link!);
  await expect(page).toHaveURL(`${E2E.baseURL}/`);
}

/**
 * The magic-link plugin allows 5 verifications per minute and IP; the suite
 * signs in more often than that from one local IP. Production limits stay as
 * they are, the E2E database just forgets the local counters.
 */
async function resetAuthRateLimits() {
  const sql = postgres(E2E.databaseUrl, { max: 1, onnotice: () => {} });
  try {
    // Better Auth keys are "<ip>|<path>"; the IP form differs between machines (::1, ::ffff:…).
    await sql`delete from rate_limits where key like '%|/%'`;
  } finally {
    await sql.end();
  }
}

/** Creates an API token in the settings and returns it. */
export async function createApiToken(page: Page, name: string): Promise<string> {
  await page.goto("/settings#api-tokens");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Token anlegen" }).click();
  const token = (await page.getByText(/^aq_[0-9A-Za-z]{32}$/).textContent())?.trim() ?? "";
  expect(token).toMatch(/^aq_/);
  return token;
}

export function publishWithCli(folder: string, token: string): string {
  return cli(["expose:publish", folder], {
    AQUISITEUR_API_TOKEN: token,
    AQUISITEUR_API_URL: E2E.baseURL,
  });
}
