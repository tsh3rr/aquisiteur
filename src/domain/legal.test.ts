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
    expect(text).toContain("Cookies werden auf dieser Seite nicht gesetzt");
    expect(text).toContain("nach 180 Tagen");
    expect(text).toContain("nach 14 Tagen");
    expect(text).toContain("Sentry (Fehlerberichte ohne personenbezogene Daten");
    expect(text).toContain("Mikrus (Server und Datenbank, Finnland)");
    expect(privacyMarkdown(settings, "X", "cloudflare")).toContain("Supabase");
    expect(text).not.toContain("Sitzungsaufzeichnung (nur mit Einwilligung)");
    expect(text).not.toContain("Pingen");
    expect(privacyMarkdown(settings, "X", "node", "pingen")).toContain("Pingen (Druck und Versand");
  });

  it("separates the basis from the reading statistics, which need consent (ADR-0065)", () => {
    const text = privacyMarkdown(base, "X");
    expect(text).toContain("**5. Verarbeitung ohne Einwilligung**");
    expect(text).toContain("**6. Lesestatistik (nur mit Einwilligung)**");
    expect(text).toContain("Art. 6 Abs. 1 lit. a DSGVO, § 25 Abs. 1 TDDDG");
    expect(text).toContain("ob Sie im Chat mit einer Eingabe begonnen haben, ohne sie abzusenden");
    expect(text).toContain("Global Privacy Control");
    expect(text).toContain("Session Storage");
    expect(text).toContain("„aq-consent“");
    expect(text).toContain("Widerspruchsrecht (Art. 21 DSGVO)");
  });

  it("numbers the sections without a gap and names the recording only when switched on", () => {
    const off = privacyMarkdown(base, "X");
    expect(off).not.toContain("Sitzungsaufzeichnung (nur mit Einwilligung)");
    expect(off).toContain("**7. Chat**");
    const on = privacyMarkdown(workspaceSettingsSchema.parse({ replay: { enabled: true } }), "X");
    expect(on).toContain("**7. Sitzungsaufzeichnung (nur mit Einwilligung)**");
    expect(on).toContain("**8. Chat**");
  });

  it("follows the sender's country and the configured data source", () => {
    const austria = workspaceSettingsSchema.parse({
      senderAddress: { country: "AT", company: "Agentur W" },
      legal: { dataSource: "dem Firmenbuch" },
    });
    const text = privacyMarkdown(austria, "X");
    expect(text).toContain("§ 165 Abs. 3 TKG 2021");
    expect(text).not.toContain("TDDDG");
    expect(text).toContain("Datenschutzbehörde, Barichgasse 40–42, 1030 Wien");
    expect(text).toContain("haben wir aus dem Firmenbuch erhoben");
  });

  it("prefer the workspace's own texts", () => {
    const own = workspaceSettingsSchema.parse({
      legal: { imprintMarkdown: "Eigenes Impressum", privacyMarkdown: "Eigener Text" },
    });
    expect(imprintMarkdown(own, "X")).toBe("Eigenes Impressum");
    expect(privacyMarkdown(own, "X")).toBe("Eigener Text");
  });
});
