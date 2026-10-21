import { describe, expect, it } from "vitest";
import {
  CONSENT_MAX_AGE_DAYS,
  CONSENT_NOTICE_VERSION,
  isStatisticsEvent,
  serializeConsent,
  storedConsent,
} from "./consent";
import { EVENT_TYPES } from "./events";

const DAY = 24 * 60 * 60 * 1000;

describe("consent on the device", () => {
  it("remembers the decisions per purpose, nothing else", () => {
    const raw = serializeConsent({ statistics: true, replay: false }, 100 * DAY);
    expect(JSON.parse(raw)).toEqual({ v: CONSENT_NOTICE_VERSION, t: 100, s: true, r: false });
    expect(storedConsent(raw, 101 * DAY)).toEqual({ statistics: true, replay: false });
  });

  it("asks again when the wording changed, the answer is old or unreadable", () => {
    const now = 400 * DAY;
    expect(storedConsent(JSON.stringify({ v: "old", t: 400, s: true, r: true }), now)).toBeNull();
    const old = serializeConsent(
      { statistics: false, replay: false },
      now - (CONSENT_MAX_AGE_DAYS + 1) * DAY,
    );
    expect(storedConsent(old, now)).toBeNull();
    expect(
      storedConsent(JSON.stringify({ v: CONSENT_NOTICE_VERSION, t: 400, s: "yes" }), now),
    ).toBeNull();
    expect(storedConsent("{broken", now)).toBeNull();
    expect(storedConsent(null, now)).toBeNull();
  });
});

describe("basis and statistics", () => {
  it("lets only the opening, sharing and the objection through without consent", () => {
    const basis = EVENT_TYPES.filter((type) => !isStatisticsEvent(type));
    expect(basis.sort()).toEqual(["opt_out", "page_view", "share"]);
    for (const type of [
      "section_view",
      "scroll_depth",
      "heartbeat",
      "cta_hover",
      "contact_click",
    ]) {
      expect(isStatisticsEvent(type)).toBe(true);
    }
  });
});
