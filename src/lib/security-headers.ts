/**
 * Security headers (§10). The CSP is per request (nonce) and set in
 * src/proxy.ts; the static headers are applied in next.config.ts.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  isDev: boolean;
  upgradeInsecure: boolean;
  /** Only the cockpit preview may be framed, and only by the cockpit itself. */
  allowSameOriginFraming?: boolean;
  /** Extra origins for fetch/WebSocket, e.g. the Supabase Realtime socket. */
  connectSrc?: string[];
  /** Extra image origins, e.g. the map tiles on the map dashboard. */
  imgSrc?: string[];
}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${options.nonce}'`,
      "'strict-dynamic'",
      ...(options.isDev ? ["'unsafe-eval'"] : []),
    ],
    // Next.js and Radix inject inline style attributes; styles cannot execute code.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...(options.imgSrc ?? [])],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(options.connectSrc ?? []), ...(options.isDev ? ["ws:"] : [])],
    "frame-ancestors": [options.allowSameOriginFraming ? "'self'" : "'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  if (options.upgradeInsecure) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export const staticSecurityHeaders: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

export const hstsHeader = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
};

/** The Realtime socket origin when Supabase Realtime is configured, for connect-src. */
export function realtimeConnectSrc(env: {
  REALTIME_PROVIDER?: string;
  SUPABASE_URL?: string;
}): string[] {
  if (env.REALTIME_PROVIDER !== "supabase" || !env.SUPABASE_URL) return [];
  try {
    return [`wss://${new URL(env.SUPABASE_URL).host}`];
  } catch {
    return [];
  }
}

/** OpenStreetMap raster tiles for the map dashboard (§7.8, ADR-0039). */
export const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILE_ORIGIN = "https://tile.openstreetmap.org";
