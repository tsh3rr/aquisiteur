import { describe, expect, it } from "vitest";
import {
  clip,
  crossedThresholds,
  DEFAULT_RULES,
  deliveryFor,
  describeRule,
  inQuietHours,
  localClock,
  notificationCopy,
  notificationUrl,
  repushOnUpdate,
  ruleInputSchema,
} from "./notifications";

const TZ = "Europe/Berlin";
const at = (iso: string) => new Date(iso);

describe("default rules", () => {
  it("match the spec: first scan, chat and callback by push, score ≥ 50 by push and e-mail, digest at 8", () => {
    expect(DEFAULT_RULES.map(describeRule)).toEqual([
      "Erster echter Scan → Push",
      "Chat-Nachricht → Push",
      "Rückrufwunsch → Push",
      "Score ab 50 % → Push und E-Mail",
      "Tägliche Zusammenfassung um 08:00 → E-Mail",
    ]);
  });
});

describe("conditions", () => {
  const quiet = { quietFrom: "22:00", quietTo: "07:00" };

  it("reads the local clock", () => {
    expect(localClock(at("2026-10-17T21:30:00Z"), TZ)).toEqual({
      hour: 23,
      minute: 30,
      weekday: 6,
    });
  });

  it("quiet hours wrap around midnight", () => {
    expect(inQuietHours(quiet, at("2026-10-16T21:30:00+02:00"), TZ)).toBe(false);
    expect(inQuietHours(quiet, at("2026-10-16T22:00:00+02:00"), TZ)).toBe(true);
    expect(inQuietHours(quiet, at("2026-10-17T06:59:00+02:00"), TZ)).toBe(true);
    expect(inQuietHours(quiet, at("2026-10-17T07:00:00+02:00"), TZ)).toBe(false);
    expect(
      inQuietHours({ quietFrom: "12:00", quietTo: "13:00" }, at("2026-10-16T12:30:00+02:00"), TZ),
    ).toBe(true);
    expect(
      inQuietHours({ quietFrom: null, quietTo: null }, at("2026-10-16T03:00:00+02:00"), TZ),
    ).toBe(false);
  });

  it("records but does not deliver outside the conditions", () => {
    const rule = { channels: ["push", "email"] as const, ...quiet, weekdaysOnly: true };
    expect(
      deliveryFor({ ...rule, channels: [...rule.channels] }, at("2026-10-16T10:00:00+02:00"), TZ),
    ).toEqual({
      channels: ["push", "email"],
      suppressed: null,
    });
    expect(
      deliveryFor({ ...rule, channels: ["push"] }, at("2026-10-17T10:00:00+02:00"), TZ),
    ).toEqual({
      channels: [],
      suppressed: "weekend",
    });
    expect(
      deliveryFor({ ...rule, channels: ["push"] }, at("2026-10-16T23:00:00+02:00"), TZ),
    ).toEqual({
      channels: [],
      suppressed: "quiet_hours",
    });
  });
});

describe("thresholds and grouping", () => {
  it("fires each threshold once, when it is passed", () => {
    expect(crossedThresholds(40, 78, [50, 80])).toEqual([50]);
    expect(crossedThresholds(78, 100, [50, 80])).toEqual([80]);
    expect(crossedThresholds(50, 60, [50])).toEqual([]);
  });

  it("only chat messages update the push", () => {
    expect(repushOnUpdate("chat_message")).toBe(true);
    expect(repushOnUpdate("first_visit")).toBe(false);
  });

  it("clips long text", () => {
    expect(clip("Hallo   Welt")).toBe("Hallo Welt");
    expect(clip("a".repeat(200), 10)).toBe("aaaaaaaaa…");
  });
});

describe("rule input", () => {
  it("accepts a score rule with quiet hours", () => {
    const parsed = ruleInputSchema.parse({
      trigger: "score_threshold",
      threshold: "80",
      channels: ["push"],
      quietFrom: "22:00",
      quietTo: "07:00",
      weekdaysOnly: true,
    });
    expect(parsed).toMatchObject({ threshold: 80, quietFrom: "22:00", quietTo: "07:00" });
    expect(describeRule(parsed)).toBe("Score ab 80 % → Push (Ruhezeit 22:00–07:00, nur werktags)");
  });

  it("explains what is wrong", () => {
    const result = ruleInputSchema.safeParse({
      trigger: "score_threshold",
      channels: [],
      quietFrom: "22:00",
      quietTo: "",
    });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    expect(messages).toEqual([
      "channels: Bitte mindestens einen Kanal wählen.",
      "threshold: Bitte eine Schwelle zwischen 1 und 100 % angeben.",
      "quietTo: Ruhezeit braucht Beginn und Ende.",
    ]);
  });

  it("drops the threshold for triggers without one", () => {
    expect(
      ruleInputSchema.parse({ trigger: "chat_message", threshold: 5, channels: ["push"] })
        .threshold,
    ).toBeNull();
  });
});

describe("notification copy", () => {
  it("says who, how and where", () => {
    expect(
      notificationCopy({
        trigger: "first_visit",
        company: "Café Müller",
        visit: { source: "qr", device: "mobile", city: "Leipzig" },
      }),
    ).toEqual({
      title: "Café Müller · Exposé geöffnet",
      body: "QR-Code · Smartphone · Leipzig",
    });
    expect(
      notificationCopy({
        trigger: "callback",
        company: "Café Müller",
        name: "Sabine Müller",
        phone: "0341 1234567",
        preferredTime: null,
      }).body,
    ).toBe("Sabine Müller · 0341 1234567");
    expect(
      notificationCopy({ trigger: "chat_message", company: "Café Müller", message: "Hallo!" }),
    ).toEqual({ title: "Café Müller · Chat", body: "Hallo!" });
  });
});

describe("notificationUrl", () => {
  const prospectId = "11111111-1111-4111-8111-111111111111";
  it("opens the spot the event happened, not an overview", () => {
    expect(notificationUrl({ trigger: "chat_message", threadId: "t1" })).toBe("/chat/t1");
    expect(notificationUrl({ trigger: "callback", prospectId })).toBe(`/kunden/${prospectId}#chat`);
    expect(notificationUrl({ trigger: "first_visit", prospectId })).toBe(
      `/kunden/${prospectId}#besuche`,
    );
    expect(notificationUrl({ trigger: "return_visit", prospectId })).toBe(
      `/kunden/${prospectId}#besuche`,
    );
    expect(notificationUrl({ trigger: "score_threshold", prospectId })).toBe(
      `/kunden/${prospectId}#kontaktabsicht`,
    );
    expect(notificationUrl({ trigger: "opt_out", prospectId })).toBe(
      `/kunden/${prospectId}#datenschutz`,
    );
    expect(notificationUrl({ trigger: "daily_digest" })).toBe("/");
  });
});
