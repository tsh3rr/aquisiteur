import { timingSafeEqual } from "@/domain/tracking/signed-token";

/**
 * Client addresses for rate limits (§10). Behind Cloudflare the visitor's
 * address is `cf-connecting-ip`; without a proxy (dev, tests) the first
 * `x-forwarded-for` entry. Both headers are only trustworthy when requests
 * cannot reach the server past Cloudflare, see ORIGIN_SECRET in
 * src/middleware.ts.
 */

/** Header Cloudflare adds to every request (Transform Rule), checked against ORIGIN_SECRET. */
export const ORIGIN_HEADER = "x-aquisiteur-origin";

export function clientIp(headers: Headers): string | null {
  const ip =
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  return ip || null;
}

/**
 * The unit a rate limit counts: an IPv4 address as is, an IPv6 address by
 * its /64 network. One IPv6 connection usually owns a whole /64, so keying on
 * the full address would let a client switch addresses for every request.
 */
export function rateLimitBucket(ip: string | null): string {
  if (!ip) return "unknown";
  const address = ip
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  if (!address.includes(":")) return address;
  // IPv4-mapped IPv6 (::ffff:203.0.113.7) is the IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1]!;
  const [head = "", tail = ""] = address.split("::", 2);
  const headGroups = head ? head.split(":") : [];
  const tailGroups = address.includes("::") && tail ? tail.split(":") : [];
  const groups = address.includes("::")
    ? [
        ...headGroups,
        ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill("0"),
        ...tailGroups,
      ]
    : headGroups;
  const network = groups
    .slice(0, 4)
    .map((group) => (group || "0").replace(/^0+(?=.)/, ""))
    .join(":");
  return `${network}::/64`;
}

/** Constant-time check of the shared secret Cloudflare adds to every request. */
export function originSecretValid(headers: Headers, secret: string): boolean {
  return timingSafeEqual(headers.get(ORIGIN_HEADER) ?? "", secret);
}
