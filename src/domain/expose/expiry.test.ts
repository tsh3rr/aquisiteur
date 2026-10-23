import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPIRY_DAY_MS,
  expiredPage,
  expiryState,
  lastActivity,
  MAX_EXPIRED_POINTS,
} from "./expiry";
import { exposeSchema, type ExposeDocument, type ExposeInput } from "./schema";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * EXPIRY_DAY_MS);

function doc(blocks: ExposeInput["blocks"]): ExposeDocument {
  return exposeSchema.parse({
    schemaVersion: 1,
    prospect: { key: "cafe-test", company: "Café Test" },
    meta: { title: "Test" },
    blocks,
  });
}

const image = (src: string) => ({ src, alt: src });

describe("expiryState", () => {
  const settings = { enabled: true, afterDays: 60 };

  it("expires exactly afterDays after the last activity", () => {
    expect(expiryState({ lastActivityAt: day(0), settings, now: day(59) })).toEqual({
      expired: false,
      expiresAt: day(60),
    });
    expect(expiryState({ lastActivityAt: day(0), settings, now: day(60) }).expired).toBe(true);
  });

  it("never expires when switched off", () => {
    expect(
      expiryState({
        lastActivityAt: day(0),
        settings: { ...settings, enabled: false },
        now: day(999),
      }),
    ).toEqual({ expired: false, expiresAt: null });
  });
});

describe("lastActivity", () => {
  it("takes the latest moment and ignores missing ones", () => {
    expect(lastActivity([day(3), null, day(10), undefined, day(5)])).toEqual(day(10));
  });

  it("falls back to the epoch without any moment", () => {
    expect(lastActivity([null]).getTime()).toBe(0);
  });
});

describe("expiredPage", () => {
  const slider = {
    id: "vorher-nachher",
    type: "before_after" as const,
    title: "Vorher und nachher",
    intro: "Langer Text, der auf der Kurzseite fehlt.",
    before: image("assets/vorher.png"),
    after: image("assets/nachher.png"),
  };

  it("keeps the first slider without its intro, proposal titles and the authored channels", () => {
    const page = expiredPage(
      doc([
        { id: "start", type: "hero", greeting: "Hallo,", headline: "Ideen" },
        slider,
        { ...slider, id: "zweiter" },
        {
          id: "probleme",
          type: "findings",
          title: "Probleme",
          items: [{ title: "Langsam", impact: "x", solution: "y" }],
        },
        {
          id: "ideen",
          type: "proposal",
          title: "Ideen",
          items: [
            { title: "Online-Termine", description: "x", benefit: "y" },
            { title: "Schnellere Seite", description: "x", benefit: "y" },
          ],
        },
        {
          id: "kontakt",
          type: "contact",
          title: "Kontakt",
          channels: ["whatsapp", "phone"],
          message: "Hallo",
        },
      ]),
    );
    expect(page.beforeAfter?.id).toBe("vorher-nachher");
    expect(page.beforeAfter?.intro).toBeUndefined();
    expect(page.points).toEqual(["Online-Termine", "Schnellere Seite"]);
    expect(page.contact).toMatchObject({
      id: "kontakt",
      channels: ["whatsapp", "phone"],
      message: "Hallo",
    });
  });

  it("falls back to findings, dedupes and caps the points", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: i === 1 ? "Punkt 0" : `Punkt ${i}`,
      impact: "x",
      solution: "y",
    }));
    const page = expiredPage(doc([{ id: "probleme", type: "findings", title: "P", items }]));
    expect(page.points).toHaveLength(MAX_EXPIRED_POINTS);
    expect(page.points.slice(0, 2)).toEqual(["Punkt 0", "Punkt 2"]);
    expect(page.beforeAfter).toBeNull();
  });

  it("offers every default channel when the exposé has no contact block", () => {
    const page = expiredPage(
      doc([{ id: "start", type: "hero", greeting: "Hallo,", headline: "x" }]),
    );
    expect(page.contact.id).toBe("kontakt");
    expect(page.contact.channels).toContain("chat");
    expect(page.points).toEqual([]);
  });

  it("works for the example exposés", () => {
    const input: unknown = JSON.parse(
      readFileSync(join(process.cwd(), "exposes", "cafe-mueller", "expose.json"), "utf8"),
    );
    const page = expiredPage(exposeSchema.parse(input));
    expect(page.beforeAfter).not.toBeNull();
    expect(page.points.length).toBeGreaterThan(0);
  });
});
