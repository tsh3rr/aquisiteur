import { describe, expect, it } from "vitest";
import { classifyHost, normalizeHost } from "./hostname";

const prod = { appHost: "app.aquisiteur.app", platformDomain: "aquisiteur.app" };
const dev = { appHost: "localhost:3000", platformDomain: "localhost" };

describe("normalizeHost()", () => {
  it("lower-cases and strips port and trailing dot", () => {
    expect(normalizeHost("GO.Agentur.DE:443")).toBe("go.agentur.de");
    expect(normalizeHost("agentur.de.")).toBe("agentur.de");
  });

  it("rejects garbage", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("evil.de/path")).toBeNull();
    expect(normalizeHost("a b.de")).toBeNull();
  });
});

describe("classifyHost()", () => {
  it("routes the app host to the cockpit", () => {
    expect(classifyHost("app.aquisiteur.app", prod)).toEqual({ kind: "cockpit" });
    expect(classifyHost("localhost:3000", dev)).toEqual({ kind: "cockpit" });
  });

  it("recognises platform subdomains", () => {
    expect(classifyHost("pixelwerk.aquisiteur.app", prod)).toEqual({
      kind: "platform-subdomain",
      slug: "pixelwerk",
    });
    expect(classifyHost("pixelwerk.localhost:3000", dev)).toEqual({
      kind: "platform-subdomain",
      slug: "pixelwerk",
    });
  });

  it("does not treat nested subdomains as workspaces", () => {
    expect(classifyHost("a.b.aquisiteur.app", prod)).toEqual({ kind: "unknown" });
  });

  it("treats other hosts as custom domains", () => {
    expect(classifyHost("go.agentur.de", prod)).toEqual({
      kind: "custom-domain",
      hostname: "go.agentur.de",
    });
  });

  it("rejects bare words and IPs as public hosts", () => {
    expect(classifyHost("intranet", prod)).toEqual({ kind: "unknown" });
    expect(classifyHost("[::1]:3000", prod)).toEqual({ kind: "unknown" });
    expect(classifyHost("127.0.0.1:3000", prod)).toEqual({ kind: "unknown" });
  });
});
