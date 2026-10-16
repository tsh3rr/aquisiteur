import { describe, expect, it } from "vitest";
import {
  addressee,
  bestTime,
  combine,
  computeIntent,
  DEFAULT_WEIGHTS,
  formatWhen,
  levelFor,
  scoreWeightsSchema,
  type ContactInfo,
  type IntentFacts,
} from ".";

const TZ = "Europe/Berlin";
const now = new Date("2026-10-16T14:40:00+02:00");
const at = (iso: string) => new Date(iso);

const info: ContactInfo = {
  company: "Café Müller",
  person: { salutation: "Frau", firstName: "Sabine", lastName: "Müller" },
  phones: ["0341 1234567"],
  emails: ["info@cafe-mueller.example"],
  refCode: "K7M2",
  preferredTime: null,
  chatThreadId: null,
};

function facts(partial: Partial<IntentFacts> = {}): IntentFacts {
  return {
    visits: [
      {
        id: "v1",
        startedAt: at("2026-10-16T14:20:00+02:00"),
        activeSeconds: 240,
        maxScroll: 90,
        device: "mobile",
        forwarded: false,
      },
    ],
    events: [],
    drafts: [],
    messages: [],
    callbacks: [],
    ...partial,
  };
}

const event = (type: string, iso: string, payload: Record<string, unknown> = {}) => ({
  visitId: "v1",
  type,
  occurredAt: at(iso),
  payload,
});

describe("combine (Noisy-OR)", () => {
  it("combines independent probabilities", () => {
    expect(combine([])).toBe(0);
    expect(combine([{ p: 0.05 }])).toBe(5);
    expect(combine([{ p: 0.7 }, { p: 0.1 }, { p: 0.15 }, { p: 0.05 }])).toBe(78);
  });

  it("only a confirmed contact reaches 100", () => {
    expect(combine([{ p: 0.99 }, { p: 0.99 }, { p: 0.99 }])).toBe(99);
    expect(combine([{ p: 0.05 }, { p: 1 }])).toBe(100);
  });
});

describe("levelFor", () => {
  it.each([
    [0, "curious"],
    [24, "curious"],
    [25, "interested"],
    [49, "interested"],
    [50, "likely"],
    [79, "likely"],
    [80, "very_likely"],
    [99, "very_likely"],
    [100, "confirmed"],
  ] as const)("%i → %s", (score, level) => expect(levelFor(score)).toBe(level));
});

describe("computeIntent", () => {
  it("explains the spec example: WhatsApp on the phone after reading and pricing", () => {
    const result = computeIntent({
      facts: facts({
        events: [
          event("pricing_change", "2026-10-16T14:26:00+02:00", { optionId: "a", selected: true }),
          event("contact_click", "2026-10-16T14:32:00+02:00", { channel: "whatsapp" }),
        ],
      }),
      info,
      now,
      timeZone: TZ,
    });
    // 1 − 0.3 · 0.85 · 0.9 · 0.95
    expect(result.score).toBe(78);
    expect(result.level).toBe("likely");
    expect(result.explanation.headline).toBe("78 % – wahrscheinlicher Kontaktversuch.");
    expect(result.explanation.detail).toBe(
      "Heute 14:32 auf dem Smartphone den WhatsApp-Button geklickt, vorher Preise angesehen und 4 min gelesen.",
    );
    expect(result.explanation.recommendation).toBe(
      "Prüfen Sie WhatsApp auf eine Nachricht mit Ref K7M2. Falls nichts da ist: Frau Müller anrufen, 0341 1234567, am besten nachmittags.",
    );
    expect(result.explanation.actions.map((a) => a.kind)).toEqual(["call", "whatsapp", "email"]);
    expect(result.explanation.actions[1]!.href).toBe(
      "https://wa.me/493411234567?text=%5BRef%20K7M2%5D%20",
    );
    expect(result.lastSignalAt).toEqual(at("2026-10-16T14:32:00+02:00"));
  });

  it("a chat message confirms the contact and points to the chat", () => {
    const result = computeIntent({
      facts: facts({ messages: [{ visitId: "v1", createdAt: at("2026-10-16T14:35:00+02:00") }] }),
      info: { ...info, chatThreadId: "t1" },
      now,
      timeZone: TZ,
    });
    expect(result.score).toBe(100);
    expect(result.explanation.headline).toBe("100 % – Kontakt bestätigt.");
    expect(result.explanation.recommendation).toBe("Antworten Sie im Chat.");
    expect(result.explanation.actions[0]).toEqual({
      kind: "chat",
      label: "Im Chat antworten",
      href: "/chat/t1",
    });
  });

  it("an unsent draft counts by its length", () => {
    const short = computeIntent({
      facts: facts({
        drafts: [{ visitId: "v1", maxLength: 12, updatedAt: at("2026-10-16T14:30:00+02:00") }],
      }),
      info,
      now,
      timeZone: TZ,
    });
    expect(short.signals.map((s) => s.id)).toContain("draft_short");
    expect(short.signals.map((s) => s.id)).not.toContain("draft_long");
    const long = computeIntent({
      facts: facts({
        drafts: [{ visitId: "v1", maxLength: 40, updatedAt: at("2026-10-16T14:30:00+02:00") }],
      }),
      info,
      now,
      timeZone: TZ,
    });
    // visit .05, read .1, short .4, long .6
    expect(long.score).toBe(79);
    expect(long.explanation.detail).toMatch(/im Chat 40 Zeichen getippt, aber nicht gesendet/);
    expect(long.explanation.recommendation).toMatch(
      /^Wollte schreiben, hat aber nicht abgeschickt/,
    );
  });

  it("detects return visits, forwarding, contact view, hover, copy and booking", () => {
    const result = computeIntent({
      facts: facts({
        visits: [
          ...facts().visits,
          {
            id: "v0",
            startedAt: at("2026-10-14T09:00:00+02:00"),
            activeSeconds: 10,
            maxScroll: 20,
            device: "desktop",
            forwarded: true,
          },
        ],
        events: [
          event("section_dwell", "2026-10-16T14:21:00+02:00", { blockType: "contact", seconds: 6 }),
          event("section_dwell", "2026-10-16T14:21:00+02:00", { blockType: "faq", seconds: 60 }),
          event("cta_hover", "2026-10-16T14:22:00+02:00", { channel: "phone" }),
          event("copy_contact", "2026-10-16T14:23:00+02:00", { channel: "email" }),
          event("contact_click", "2026-10-16T14:24:00+02:00", { channel: "booking" }),
        ],
      }),
      info,
      now,
      timeZone: TZ,
    });
    expect(result.signals.map((s) => s.id).sort()).toEqual(
      [
        "booking_open",
        "contact_copied",
        "contact_hover",
        "contact_view",
        "forwarded",
        "read",
        "return_visit",
        "visit",
      ].sort(),
    );
    expect(result.explanation.recommendation).toMatch(
      /^Prüfen Sie Ihren Kalender auf eine neue Buchung/,
    );
  });

  it("uses the workspace's weights", () => {
    const weights = scoreWeightsSchema.parse({ visit: 0.3 });
    const result = computeIntent({
      facts: facts({ visits: [{ ...facts().visits[0]!, activeSeconds: 5, maxScroll: 10 }] }),
      weights,
      info,
      now,
      timeZone: TZ,
    });
    expect(result.score).toBe(30);
    expect(result.explanation.recommendation).toMatch(/^Guter Zeitpunkt, sich zu melden/);
  });

  it("rejects broken weights instead of failing", () => {
    expect(scoreWeightsSchema.parse({ visit: 3 })).toEqual({});
    expect(Object.keys(DEFAULT_WEIGHTS)).not.toContain("confirmed");
  });

  it("says so when nothing happened", () => {
    const result = computeIntent({ facts: facts({ visits: [] }), info, now, timeZone: TZ });
    expect(result.score).toBe(0);
    expect(result.explanation.detail).toBeNull();
    expect(result.lastSignalAt).toBeNull();
  });

  it("a callback request recommends calling back at the wish time", () => {
    const result = computeIntent({
      facts: facts({ callbacks: [{ visitId: "v1", createdAt: at("2026-10-16T14:36:00+02:00") }] }),
      info: { ...info, phones: ["0170 7654321"], preferredTime: "Dienstag ab 15 Uhr" },
      now,
      timeZone: TZ,
    });
    expect(result.explanation.recommendation).toBe(
      "Rufen Sie Frau Müller zurück, 0170 7654321, Wunschzeit: Dienstag ab 15 Uhr.",
    );
  });
});

describe("helpers", () => {
  it("formats the time relative to today", () => {
    expect(formatWhen(at("2026-10-16T09:05:00+02:00"), now, TZ)).toBe("Heute 09:05");
    expect(formatWhen(at("2026-10-15T21:00:00+02:00"), now, TZ)).toBe("Gestern 21:00");
    expect(formatWhen(at("2026-10-02T08:00:00+02:00"), now, TZ)).toBe("Am 2.10. um 08:00");
  });

  it("finds the usual reading time", () => {
    expect(bestTime([], TZ)).toBeNull();
    expect(
      bestTime(
        [
          at("2026-10-14T09:00:00+02:00"),
          at("2026-10-15T10:00:00+02:00"),
          at("2026-10-16T19:00:00+02:00"),
        ],
        TZ,
      ),
    ).toBe("vormittags");
  });

  it("addresses people politely", () => {
    expect(addressee(info)).toBe("Frau Müller");
    expect(
      addressee({ ...info, person: { salutation: null, firstName: "Sabine", lastName: "Müller" } }),
    ).toBe("Sabine Müller");
    expect(addressee({ ...info, person: null })).toBe("Café Müller");
  });
});
