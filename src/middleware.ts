import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { classifyHost } from "@/domain/hostname";
import { applyClientIp, originSecretValid } from "@/lib/client-ip";
import {
  buildContentSecurityPolicy,
  COCKPIT_SOURCES,
  EXPOSE_SOURCES,
  realtimeConnectSrc,
} from "@/lib/security-headers";

/**
 * Edge entry point (§6.1): one app, split by Host header.
 * Deliberately `middleware.ts` (Edge runtime) rather than Next 16's `proxy.ts`
 * (Node runtime only): OpenNext supports Edge middleware on Workers, Node
 * middleware only experimentally. See docs/DECISIONS.md ADR-0006.
 * - APP_URL's host serves the cockpit (session cookie required except on public auth pages).
 * - Every other host is rewritten to /sites/<host>/…, where the workspace is
 *   resolved from the database (platform subdomain or custom domain).
 * Also sets a per-request CSP nonce.
 *
 * With ORIGIN_SECRET set, every request must carry it in the header that a
 * Cloudflare Transform Rule adds (src/lib/client-ip.ts). Requests that reach
 * the server past Cloudflare are refused, so nobody can forge the client
 * address the rate limits count by (§10, docs/SECURITY.md). Every request
 * gets the trusted client address in one header (`applyClientIp`).
 */

// /api/v1 authenticates with workspace API tokens, /api/jobs with CRON_SECRET,
// /api/webhooks with the provider's signature.
const PUBLIC_COCKPIT_PATHS = [
  "/login",
  "/api/auth",
  "/api/v1",
  "/api/jobs",
  "/api/webhooks",
  "/sw.js",
  "/manifest.webmanifest",
  "/robots.txt",
];

export function middleware(request: NextRequest) {
  // Health checks call the container directly (Host: localhost), before any host routing.
  if (request.nextUrl.pathname === "/healthz") {
    return NextResponse.rewrite(new URL("/api/health", request.url));
  }
  const originSecret = process.env.ORIGIN_SECRET;
  if (originSecret && !originSecretValid(request.headers, originSecret)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const appUrl = process.env.APP_URL;
  const platformDomain = process.env.PLATFORM_DOMAIN;
  if (!appUrl || !platformDomain) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const target = classifyHost(request.headers.get("host"), {
    appHost: new URL(appUrl).host,
    platformDomain,
  });
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecure: appUrl.startsWith("https:"),
    allowSameOriginFraming: request.nextUrl.pathname.startsWith("/preview/"),
    ...(target.kind === "cockpit" ? COCKPIT_SOURCES : EXPOSE_SOURCES),
    connectSrc: realtimeConnectSrc({
      REALTIME_PROVIDER: process.env.REALTIME_PROVIDER,
      SUPABASE_URL: process.env.SUPABASE_URL,
    }),
  });
  const requestHeaders = new Headers(request.headers);
  // Cloudflare's headers count only where every request must pass Cloudflare.
  applyClientIp(
    requestHeaders,
    Boolean(originSecret) || process.env.HOSTING_PROFILE === "cloudflare",
  );
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const { pathname } = request.nextUrl;

  let response: NextResponse;
  if (target.kind === "cockpit") {
    if (pathname === "/sites" || pathname.startsWith("/sites/")) {
      response = new NextResponse("Not found", { status: 404 });
    } else if (
      !PUBLIC_COCKPIT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) &&
      !getSessionCookie(request, { cookiePrefix: "aq" })
    ) {
      // Cheap cookie presence check; layouts validate the session for real.
      const login = new URL("/login", request.url);
      if (pathname !== "/") login.searchParams.set("next", pathname);
      response = NextResponse.redirect(login);
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } });
    }
  } else if (target.kind === "unknown") {
    response = new NextResponse("Unknown host", { status: 404 });
  } else {
    const host =
      target.kind === "platform-subdomain" ? `${target.slug}.${platformDomain}` : target.hostname;
    const url = request.nextUrl.clone();
    url.pathname = `/sites/${encodeURIComponent(host)}${pathname === "/" ? "" : pathname}`;
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  response.headers.set("content-security-policy", csp);
  // Neither the cockpit nor exposés may be indexed (§6.1).
  response.headers.set("x-robots-tag", "noindex, nofollow");
  // An exposé's address is its only key: never hand it on to another site (ADR-0066).
  if (target.kind !== "cockpit") response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export const config = {
  matcher: [
    // Prefetches too: a client could otherwise skip the origin guard and the
    // client address rewrite just by sending the prefetch header.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|fonts/).*)",
  ],
};
