import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  COCKPIT_SOURCES,
  EXPOSE_SOURCES,
  realtimeConnectSrc,
} from "./security-headers";

describe("buildContentSecurityPolicy()", () => {
  it("locks production down to self + nonce", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc", isDev: false, upgradeInsecure: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("allows eval and websockets only in development", () => {
    const csp = buildContentSecurityPolicy({ nonce: "abc", isDev: true, upgradeInsecure: false });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws:");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("adds the Supabase Realtime socket when configured", () => {
    const connectSrc = realtimeConnectSrc({
      REALTIME_PROVIDER: "supabase",
      SUPABASE_URL: "https://abcd.supabase.co",
    });
    expect(connectSrc).toEqual(["wss://abcd.supabase.co"]);
    expect(
      realtimeConnectSrc({ REALTIME_PROVIDER: "memory", SUPABASE_URL: "https://x.co" }),
    ).toEqual([]);
    const csp = buildContentSecurityPolicy({
      nonce: "abc",
      isDev: false,
      upgradeInsecure: true,
      connectSrc,
    });
    expect(csp).toContain("connect-src 'self' wss://abcd.supabase.co;");
  });

  it("lets the cockpit load map tiles, replay assets and WebAssembly, not JS eval", () => {
    const csp = buildContentSecurityPolicy({
      nonce: "n",
      isDev: false,
      upgradeInsecure: false,
      ...COCKPIT_SOURCES,
    });
    expect(csp).toContain("img-src 'self' data: blob: https:;");
    expect(csp).toContain("font-src 'self' https:;");
    expect(csp).toContain("'strict-dynamic' 'wasm-unsafe-eval';");
    expect(csp).toContain("connect-src 'self' data:;");
    expect(csp).not.toContain("'unsafe-eval'");
    // Exposé hosts: WebAssembly for the PDF download, but no outside images or fonts.
    const exposeCsp = buildContentSecurityPolicy({
      nonce: "n",
      isDev: false,
      upgradeInsecure: false,
      ...EXPOSE_SOURCES,
    });
    expect(exposeCsp).toContain("'strict-dynamic' 'wasm-unsafe-eval';");
    expect(exposeCsp).not.toContain("'unsafe-eval'");
    expect(exposeCsp).toContain("img-src 'self' data: blob:;");
    expect(exposeCsp).toContain("font-src 'self';");
  });
});
