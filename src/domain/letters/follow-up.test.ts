import { describe, expect, it } from "vitest";
import { FOLLOW_UP_WINDOW_DAYS, followUpDecision, type FollowUpCandidate } from "./follow-up";

const DAY = 24 * 3600 * 1000;
const postedAt = new Date("2026-10-01T09:00:00Z");
const after = (days: number) => new Date(postedAt.getTime() + days * DAY);
const candidate = (overrides: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
  postedAt,
  openedAt: null,
  doNotContact: false,
  hasFollowUp: false,
  ...overrides,
});
const on = { enabled: true, afterDays: 14 };

describe("followUpDecision", () => {
  it("waits until the letter has been out for afterDays", () => {
    expect(followUpDecision(candidate(), on, after(13))).toBe("wait");
    expect(followUpDecision(candidate(), on, after(14))).toBe("due");
    expect(followUpDecision(candidate(), { ...on, afterDays: 7 }, after(7))).toBe("due");
  });

  it("never follows up once the exposé was opened, on a block marker or twice", () => {
    expect(followUpDecision(candidate({ openedAt: after(2) }), on, after(20))).toBe("skip");
    expect(followUpDecision(candidate({ doNotContact: true }), on, after(20))).toBe("skip");
    expect(followUpDecision(candidate({ hasFollowUp: true }), on, after(20))).toBe("skip");
  });

  it("leaves letters alone that are long past the window", () => {
    expect(followUpDecision(candidate(), on, after(14 + FOLLOW_UP_WINDOW_DAYS))).toBe("due");
    expect(followUpDecision(candidate(), on, after(15 + FOLLOW_UP_WINDOW_DAYS))).toBe("skip");
  });

  it("does nothing while the rule is off, so turning it on later still works", () => {
    expect(followUpDecision(candidate(), { ...on, enabled: false }, after(20))).toBe("wait");
  });
});
