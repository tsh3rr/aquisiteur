import { timingSafeEqual } from "@/domain/tracking/signed-token";

/**
 * Client addresses for rate limits (§10). The middleware decides once per
 * request which address to trust and passes it on in CLIENT_IP_HEADER;
 * everything else reads only that header.
 *
 * - Behind Cloudflare with the origin guard (ORIGIN_SECRET) or on Workers:
 *   `cf-connecting-ip`, set by Cloudflare and not forgeable there.
 * - Otherwise (e.g. the Mikrus proxy in front of Docker Compose): the last
 *   `x-forwarded-for` entry, the one the proxy in front of the app appended.
 *   Cloudflare's headers (`cf-*`) are dropped, since any client can send them.
 *
 * Without a guaranteed path through the proxy a client can still pick its
 * address, so per-address limits are best effort and every limit that
 * protects something also has a cap that does not depend on the address.
 */

/** Header Cloudflare adds to every request (Transform Rule), checked against ORIGIN_SECRET. */
export const ORIGIN_HEADER = "x-aquisiteur-origin";

/** The trusted client address, set by the middleware only. */
export const CLIENT_IP_HEADER = "x-aquisiteur-client-ip";

export function trustedClientIp(headers: Headers, behindCloudflare: boolean): string | null {
  if (behindCloudflare) return headers.get("cf-connecting-ip")?.trim() || null;
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? null;
}

/**
 * Rewrites the request headers the app sees: sets CLIENT_IP_HEADER (or
 * removes a forged one) and, unless Cloudflare is guaranteed, drops `cf-*`.
 */
export function applyClientIp(headers: Headers, behindCloudflare: boolean): void {
  const ip = trustedClientIp(headers, behindCloudflare);
  if (!behindCloudflare) {
    for (const name of [...headers.keys()]) if (name.startsWith("cf-")) headers.delete(name);
  }
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
}

export function clientIp(headers: Headers): string | null {
  return headers.get(CLIENT_IP_HEADER)?.trim() || null;
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
