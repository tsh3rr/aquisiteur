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
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...(options.isDev ? ["ws:"] : [])],
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
