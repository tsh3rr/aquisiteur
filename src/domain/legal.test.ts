import { describe, expect, it } from "vitest";
import { imprintMarkdown, privacyMarkdown } from "./legal";
import { workspaceSettingsSchema } from "./workspace-settings";

const base = workspaceSettingsSchema.parse({});

describe("generated legal texts", () => {
  it("explain tracking, retention and processors with the workspace's own periods", () => {
    const settings = workspaceSettingsSchema.parse({
      retention: { eventsDays: 180, replaysDays: 60, optOutTrackingDays: 14 },
    });
    const text = privacyMarkdown(settings, "Agentur X");
    expect(text).toContain("Agentur X");
    expect(text).toContain("Ohne Cookies");
    expect(text).toContain("nach 180 Tagen");
    expect(text).toContain("nach 14 Tagen");
    expect(text).toContain("Sentry (EU)");
    expect(text).toContain("Mikrus in Finnland (EU)");
    expect(privacyMarkdown(settings, "X", "cloudflare")).toContain("Supabase");
    expect(text).not.toContain("Aufzeichnung nur mit Ihrer Erlaubnis");
  });

  it("names draft detection as yes/no only and recordings only when switched on", () => {
    const text = privacyMarkdown(base, "X");
    expect(text).toContain("nur, dass Sie angefangen haben zu schreiben");
    expect(text).toContain("Session Storage");
    expect(text).toContain("nur, dass Sie gerade da sind");
    expect(text).not.toContain("Aufzeichnung nur mit Ihrer Erlaubnis");
    const on = workspaceSettingsSchema.parse({ replay: { enabled: true } });
    expect(privacyMarkdown(on, "X")).toContain("Aufzeichnung nur mit Ihrer Erlaubnis");
  });

  it("prefer the workspace's own texts", () => {
    const own = workspaceSettingsSchema.parse({
      legal: { imprintMarkdown: "Eigenes Impressum", privacyMarkdown: "Eigener Text" },
    });
    expect(imprintMarkdown(own, "X")).toBe("Eigenes Impressum");
    expect(privacyMarkdown(own, "X")).toBe("Eigener Text");
  });
});
