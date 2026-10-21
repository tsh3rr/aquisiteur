import type { MetadataRoute } from "next";

/**
 * Crawlers that collect pages for AI models. They do not reliably honour
 * `noindex`, so they are kept out entirely.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "PerplexityBot",
  "Bytespider",
  "meta-externalagent",
  "Amazonbot",
  "cohere-ai",
] as const;

/**
 * robots.txt for the cockpit and every exposé host (§6.1, ADR-0066).
 * Search engines may fetch pages, because only a fetched page shows them
 * `X-Robots-Tag: noindex`: a page blocked here can still be listed by its
 * bare URL when it is linked from elsewhere. The tracking endpoints are
 * no pages. No sitemap, on purpose.
 */
export const ROBOTS_RULES: MetadataRoute.Robots["rules"] = [
  { userAgent: "*", allow: "/", disallow: "/t/" },
  { userAgent: [...AI_CRAWLERS], disallow: "/" },
];

/** The same rules as plain text, for the exposé hosts' route handler. */
export function robotsTxt(): string {
  const rules = Array.isArray(ROBOTS_RULES) ? ROBOTS_RULES : [ROBOTS_RULES];
  const lines = (value: string | string[] | undefined, key: string) =>
    (Array.isArray(value) ? value : value ? [value] : []).map((item) => `${key}: ${item}`);
  return rules
    .map((rule) =>
      [
        ...lines(rule.userAgent, "User-agent"),
        ...lines(rule.allow, "Allow"),
        ...lines(rule.disallow, "Disallow"),
      ].join("\n"),
    )
    .join("\n\n")
    .concat("\n");
}
