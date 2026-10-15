import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
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
