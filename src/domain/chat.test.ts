import { describe, expect, it } from "vitest";
import {
  callbackRequestSchema,
  isAvailable,
  issuesByField,
  joinGerman,
  offlineNoticeDue,
  offlineNoticeText,
  returnChannelSchema,
  visitorMessageSchema,
} from "./chat";

const token = "x".repeat(40);
const now = Date.parse("2026-10-16T10:00:00Z");
const ago = (seconds: number) => new Date(now - seconds * 1000);

describe("chat request schemas", () => {
  it("trims messages and refuses empty ones", () => {
    expect(visitorMessageSchema.parse({ token, body: "  Hallo  " }).body).toBe("Hallo");
    expect(visitorMessageSchema.safeParse({ token, body: "   " }).success).toBe(false);
    expect(visitorMessageSchema.safeParse({ token, body: "x".repeat(2001) }).success).toBe(false);
  });

  it("asks for the address that fits the chosen return channel", () => {
    const email = returnChannelSchema.safeParse({ chat: token, channel: "email", email: "" });
    expect(email.success).toBe(false);
    expect(issuesByField(email.error!)).toEqual({ email: "Bitte Ihre E-Mail-Adresse angeben." });
    const whatsapp = returnChannelSchema.parse({
      chat: token,
      channel: "whatsapp",
      phone: "0170 1234567",
      name: " ",
    });
    expect(whatsapp).toMatchObject({ phone: "0170 1234567", name: undefined });
  });

  it("validates callback requests and trips on the honeypot", () => {
    const valid = { slug: "cafe-mueller", name: "Sabine", phone: "0341 123456" };
    expect(callbackRequestSchema.parse({ ...valid, preferredTime: "" }).preferredTime).toBe(
      undefined,
    );
    expect(callbackRequestSchema.safeParse({ ...valid, phone: "abc" }).success).toBe(false);
    expect(callbackRequestSchema.safeParse({ ...valid, website: "spam" }).success).toBe(false);
  });
});

describe("isAvailable()", () => {
  it("counts an open cockpit within three minutes and manual states", () => {
    expect(isAvailable([{ availability: "auto", lastActiveAt: ago(60) }], now)).toBe(true);
    expect(isAvailable([{ availability: "auto", lastActiveAt: ago(200) }], now)).toBe(false);
    expect(isAvailable([{ availability: "available", lastActiveAt: ago(9999) }], now)).toBe(true);
    expect(isAvailable([{ availability: "away", lastActiveAt: ago(1) }], now)).toBe(false);
    expect(isAvailable([], now)).toBe(false);
  });
});

describe("offlineNoticeDue()", () => {
  const base = { lastVisitorMessageAt: ago(121), lastOwnerMessageAt: null, offlineNoticeAt: null };

  it("is due two minutes after an unanswered message", () => {
    expect(offlineNoticeDue(base, now)).toBe(true);
    expect(offlineNoticeDue({ ...base, lastVisitorMessageAt: ago(100) }, now)).toBe(false);
    expect(offlineNoticeDue({ ...base, lastVisitorMessageAt: null }, now)).toBe(false);
  });

  it("is not due when the owner answered or a notice went out", () => {
    expect(offlineNoticeDue({ ...base, lastOwnerMessageAt: ago(30) }, now)).toBe(false);
    expect(offlineNoticeDue({ ...base, offlineNoticeAt: ago(10) }, now)).toBe(false);
    // An older notice belongs to an earlier stretch.
    expect(offlineNoticeDue({ ...base, offlineNoticeAt: ago(600) }, now)).toBe(true);
  });
});

describe("offline notice text", () => {
  it("lists the alternatives in German", () => {
    expect(joinGerman(["per WhatsApp"])).toBe("per WhatsApp");
    expect(offlineNoticeText("Danke!", ["per WhatsApp", "telefonisch", "per E-Mail"])).toBe(
      "Danke! Sie erreichen mich auch per WhatsApp, telefonisch oder per E-Mail.",
    );
    expect(offlineNoticeText("Danke!", [])).toBe("Danke!");
  });
});
