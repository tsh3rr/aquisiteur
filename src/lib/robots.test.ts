import { describe, expect, it } from "vitest";
import { AI_CRAWLERS, robotsTxt } from "./robots";

/** §6.1: exposés stay out of search, which needs crawlers to see `noindex` (ADR-0066). */
describe("robots.txt", () => {
  const text = robotsTxt();

  it("lets search engines fetch pages, so they see noindex", () => {
    expect(text).toMatch(/^User-agent: \*\nAllow: \/\nDisallow: \/t\/\n/);
    expect(text).not.toMatch(/^User-agent: \*\n(?:.+\n)*Disallow: \/\n/);
  });

  it("keeps AI crawlers out entirely", () => {
    const block = text.split("\n\n")[1]!;
    for (const crawler of AI_CRAWLERS) expect(block).toContain(`User-agent: ${crawler}\n`);
    expect(block.trimEnd().endsWith("Disallow: /")).toBe(true);
  });

  it("names no sitemap", () => {
    expect(text.toLowerCase()).not.toContain("sitemap");
  });
});
