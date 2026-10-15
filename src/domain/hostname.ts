/**
 * Host-based routing (§6.1, §9a). The cockpit lives on APP_URL's host; every
 * other host serves a workspace's public pages (exposés, short links) and is
 * resolved either as a platform subdomain or as a registered custom domain.
 */
export type HostTarget =
  | { kind: "cockpit" }
  | { kind: "platform-subdomain"; slug: string }
  | { kind: "custom-domain"; hostname: string }
  | { kind: "unknown" };

/** Lower-cases, strips the port and a trailing dot. Returns null for garbage. */
export function normalizeHost(rawHost: string | null | undefined): string | null {
  if (!rawHost) return null;
  const host = rawHost.trim().toLowerCase().replace(/\.$/, "");
  // Strip port; IPv6 literals keep their brackets.
  const withoutPort = host.startsWith("[") ? host.replace(/]:\d+$/, "]") : host.replace(/:\d+$/, "");
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/.test(withoutPort)) return null;
  if (withoutPort.length > 253) return null;
  return withoutPort;
}

export function classifyHost(
  rawHost: string | null | undefined,
  config: { appHost: string; platformDomain: string },
): HostTarget {
  const host = normalizeHost(rawHost);
  if (!host) return { kind: "unknown" };
  const appHost = normalizeHost(config.appHost);
  const platformDomain = normalizeHost(config.platformDomain);
  if (host === appHost) return { kind: "cockpit" };
  if (platformDomain && host.endsWith(`.${platformDomain}`)) {
    const label = host.slice(0, -(platformDomain.length + 1));
    // Only direct subdomains: a.b.<platform> is not a workspace.
    if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { kind: "platform-subdomain", slug: label };
    }
    return { kind: "unknown" };
  }
  const isIpLiteral = host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (host.includes(".") && !isIpLiteral) return { kind: "custom-domain", hostname: host };
  return { kind: "unknown" };
}
