import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

/** §10: with ORIGIN_SECRET set, only requests through Cloudflare are served. */
describe("middleware origin guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const request = (headers: Record<string, string> = {}, path = "/login") =>
    new NextRequest(`https://app.example.test${path}`, {
      headers: { host: "app.example.test", ...headers },
    });

  it("refuses requests without the secret header", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "origin-secret-origin-secret");
    expect(middleware(request()).status).toBe(403);
    expect(middleware(request({ "x-aquisiteur-origin": "wrong" })).status).toBe(403);
    expect(
      middleware(request({ "x-aquisiteur-origin": "origin-secret-origin-secret" })).status,
    ).toBe(200);
  });

  it("keeps the container health check reachable", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "origin-secret-origin-secret");
    expect(middleware(request({}, "/healthz")).status).not.toBe(403);
  });

  it("serves everything when no secret is configured", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "");
    expect(middleware(request()).status).toBe(200);
  });

  it("hands the app the proxy's client address, never a forged one", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "");
    const response = middleware(
      request({
        "cf-connecting-ip": "203.0.113.7",
        "x-aquisiteur-client-ip": "10.0.0.1",
        "x-forwarded-for": "203.0.113.7, 192.0.2.10",
      }),
    );
    expect(response.headers.get("x-middleware-request-x-aquisiteur-client-ip")).toBe("192.0.2.10");
    expect(response.headers.get("x-middleware-request-cf-connecting-ip")).toBeNull();
  });
});

/** §6.1, ADR-0066: nothing is indexed, and an exposé's address never leaves as a referrer. */
describe("middleware search and referrer headers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const at = (host: string, path: string) =>
    middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));

  it("marks cockpit and exposé hosts noindex", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "");
    expect(at("app.example.test", "/login").headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(at("agentur.example.test", "/x/cafe-k7m2abcdef").headers.get("x-robots-tag")).toBe(
      "noindex, nofollow",
    );
  });

  it("sends no referrer from exposé hosts", () => {
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("PLATFORM_DOMAIN", "example.test");
    vi.stubEnv("ORIGIN_SECRET", "");
    expect(at("agentur.example.test", "/x/cafe-k7m2abcdef").headers.get("referrer-policy")).toBe(
      "no-referrer",
    );
    expect(at("app.example.test", "/login").headers.get("referrer-policy")).toBeNull();
  });
});
