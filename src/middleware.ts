import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { classifyHost } from "@/domain/hostname";
import {
  buildContentSecurityPolicy,
  MAP_TILE_ORIGIN,
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
 */

// /api/v1 authenticates with workspace API tokens, /api/jobs with CRON_SECRET.
const PUBLIC_COCKPIT_PATHS = [
  "/login",
  "/api/auth",
  "/api/v1",
  "/api/jobs",
  "/sw.js",
  "/manifest.webmanifest",
  "/robots.txt",
];

export function middleware(request: NextRequest) {
  const appUrl = process.env.APP_URL;
  const platformDomain = process.env.PLATFORM_DOMAIN;
  if (!appUrl || !platformDomain) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecure: appUrl.startsWith("https:"),
    allowSameOriginFraming: request.nextUrl.pathname.startsWith("/preview/"),
    imgSrc: request.nextUrl.pathname.startsWith("/auswertung/karte") ? [MAP_TILE_ORIGIN] : [],
    connectSrc: realtimeConnectSrc({
      REALTIME_PROVIDER: process.env.REALTIME_PROVIDER,
      SUPABASE_URL: process.env.SUPABASE_URL,
    }),
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const target = classifyHost(request.headers.get("host"), {
    appHost: new URL(appUrl).host,
    platformDomain,
  });
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
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|fonts/).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
