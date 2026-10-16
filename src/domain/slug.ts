/**
 * Workspace slugs become the platform fallback subdomain
 * (<slug>.<PLATFORM_DOMAIN>), so they must be valid DNS labels and must not
 * shadow hosts the platform itself uses.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "api",
  "www",
  "go",
  "admin",
  "auth",
  "mail",
  "smtp",
  "status",
  "docs",
  "help",
  "support",
  "static",
  "assets",
  "cdn",
  "billing",
  "aquisiteur",
]);

const transliterations: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
  æ: "ae",
  ø: "oe",
  å: "aa",
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüßæøå]/g, (char) => transliterations[char] ?? char)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export type SlugProblem = "too_short" | "too_long" | "invalid_chars" | "reserved";

export function validateSlug(slug: string): SlugProblem | null {
  if (slug.length < 3) return "too_short";
  if (slug.length > 40) return "too_long";
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) return "invalid_chars";
  if (RESERVED_SLUGS.has(slug)) return "reserved";
  return null;
}
