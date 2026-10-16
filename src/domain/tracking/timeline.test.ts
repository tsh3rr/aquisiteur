import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  describeDraft,
  describeEvent,
  formatDuration,
  visitDetail,
  visitTitle,
  type TimelineVisit,
} from "./timeline";

const outline = {
  blocks: new Map([
    ["preise", "Preise"],
    ["kontakt-cta", "Button „Jetzt sprechen“"],
  ]),
  pricingOptions: new Map([["preise:website", "Neue Website"]]),
};

const visit = (overrides: Partial<TimelineVisit> = {}): TimelineVisit => ({
  id: "v1",
  source: "qr",
  device: "mobile",
  browser: "Safari",
  os: "iOS",
  city: "Leipzig",
  isBot: false,
  botReason: null,
  isInternal: false,
  confirmedAt: new Date("2026-10-01T10:00:00Z"),
  startedAt: new Date("2026-10-01T10:00:00Z"),
  activeSeconds: 195,
  maxScroll: 75,
  touchpointLabel: "Brief",
  ...overrides,
});

describe("timeline wording", () => {
  it("formats durations", () => {
    expect(formatDuration(48)).toBe("48 s");
    expect(formatDuration(195)).toBe("3 min 15 s");
    expect(formatDuration(3720)).toBe("1 h 2 min");
  });

  it("names how a visit started and flags bots, owners and unloaded pages", () => {
    expect(visitTitle(visit())).toBe("Per QR-Code geöffnet");
    expect(visitTitle(visit({ source: "typed" }))).toBe("Kurzlink abgetippt");
    expect(visitTitle(visit({ isBot: true, botReason: "WhatsApp-Vorschau" }))).toBe(
      "Link-Vorschau oder Bot (WhatsApp-Vorschau)",
    );
    expect(visitTitle(visit({ isInternal: true }))).toBe(
      "Per QR-Code geöffnet (Ihr eigenes Gerät)",
    );
    expect(visitTitle(visit({ confirmedAt: null }))).toBe(
      "Per QR-Code aufgerufen, Seite nicht geladen",
    );
    expect(visitDetail(visit())).toBe(
      "Smartphone, iOS, Safari · Leipzig · 3 min 15 s aktiv · 75 % gescrollt · über „Brief“",
    );
  });

  it("describes reading and contact events with the exposé's names", () => {
    const at = new Date();
    const event = (type: string, blockId: string | null, payload = {}) =>
      describeEvent({ visitId: "v1", type, blockId, payload, occurredAt: at }, outline);
    expect(event("section_dwell", "preise", { seconds: 35 })).toBe("„Preise“ 35 s gelesen");
    expect(event("contact_click", "kontakt", { channel: "whatsapp" })).toBe(
      "Kontakt per WhatsApp angeklickt",
    );
    expect(event("pricing_change", "preise", { optionId: "website", selected: true })).toBe(
      "Preisoption „Neue Website“ gewählt",
    );
    expect(event("cta_click", "kontakt-cta")).toBe("Button „Jetzt sprechen“ geklickt");
    expect(event("section_view", "preise")).toBeNull();
    expect(event("heartbeat", null)).toBeNull();
  });

  it("hides bots unless asked and sorts newest first", () => {
    const bot = visit({ id: "v2", isBot: true, startedAt: new Date("2026-10-02T09:00:00Z") });
    const input = {
      visits: [visit(), bot],
      events: [
        {
          visitId: "v1",
          type: "section_dwell",
          blockId: "preise",
          payload: { seconds: 35 },
          occurredAt: new Date("2026-10-01T10:02:00Z"),
        },
      ],
      audits: [
        {
          action: "prospect.status_changed",
          meta: { from: "draft", to: "opened", via: "visit" },
          createdAt: new Date("2026-10-01T10:00:01Z"),
          actorName: null,
        },
      ],
      outline,
    };
    const hidden = buildTimeline({ ...input, showBots: false });
    expect(hidden.map((entry) => entry.title)).toEqual([
      "Status: Geöffnet",
      "Per QR-Code geöffnet",
    ]);
    expect(hidden[0]!.detail).toBe("automatisch beim ersten Besuch");
    expect(hidden[1]!.steps.map((step) => step.text)).toEqual(["„Preise“ 35 s gelesen"]);
    const shown = buildTimeline({ ...input, showBots: true });
    expect(shown[0]!.muted).toBe(true);
    expect(shown).toHaveLength(3);
  });

  it("describes chat, callback and nudge events", () => {
    const at = new Date();
    const event = (type: string, payload = {}) =>
      describeEvent({ visitId: "v1", type, blockId: null, payload, occurredAt: at }, outline);
    expect(event("chat_open", { source: "nudge" })).toBe("Chat geöffnet über einen Hinweis");
    expect(event("chat_message_sent", { length: 42 })).toBe("Chat-Nachricht gesendet (42 Zeichen)");
    expect(event("callback_submitted")).toBe("Rückruf angefordert");
    expect(event("nudge_clicked", { nudge: "pricing" })).toBe(
      "Hinweis angeklickt: Angebot zur Preisauswahl",
    );
    expect(event("contact_click", { channel: "booking" })).toBe(
      "Kontakt per Terminbuchung angeklickt",
    );
  });

  it("shows typed but unsent chat drafts as a step of their visit", () => {
    const draft = {
      visitId: "v1",
      length: 0,
      maxLength: 0,
      sent: false,
      content: null,
      updatedAt: new Date("2026-10-01T10:03:00Z"),
    };
    expect(describeDraft({ ...draft, length: 87 })).toBe(
      "87 Zeichen in den Chat getippt, aber nicht gesendet",
    );
    expect(describeDraft({ ...draft, length: 12, content: "Was kostet" })).toBe(
      "12 Zeichen in den Chat getippt, aber nicht gesendet: „Was kostet“",
    );
    expect(describeDraft({ ...draft, maxLength: 30 })).toBe(
      "Chat-Nachricht mit 30 Zeichen angefangen und wieder gelöscht",
    );
    expect(describeDraft({ ...draft, maxLength: 30, sent: true })).toBeNull();

    const [entry] = buildTimeline({
      visits: [visit()],
      events: [],
      audits: [],
      drafts: [{ ...draft, length: 87 }],
      outline,
      showBots: false,
    });
    expect(entry!.steps.map((step) => step.text)).toEqual([
      "87 Zeichen in den Chat getippt, aber nicht gesendet",
    ]);
  });
});
