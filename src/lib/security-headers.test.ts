import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./security-headers";

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
});
