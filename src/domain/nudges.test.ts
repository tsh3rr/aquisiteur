import { describe, expect, it } from "vitest";
import {
  isFastScrollUp,
  nudgeCopy,
  offerRequestText,
  pickNudge,
  showStickyBar,
  type NudgeState,
} from "./nudges";
import { nudgeSettingsSchema } from "./workspace-settings";

const settings = nudgeSettingsSchema.parse({});
const quiet: NudgeState = {
  readRatio: 0,
  activeSeconds: 0,
  pricingTouched: false,
  returning: false,
  exitIntent: false,
  chatOpen: false,
  shown: false,
};

describe("pickNudge()", () => {
  it("stays quiet without a signal", () => {
    expect(pickNudge(quiet, settings)).toBeNull();
  });

  it("invites after 60 % read and 90 s, not before", () => {
    expect(pickNudge({ ...quiet, readRatio: 0.6, activeSeconds: 89 }, settings)).toBeNull();
    expect(pickNudge({ ...quiet, readRatio: 0.59, activeSeconds: 200 }, settings)).toBeNull();
    expect(pickNudge({ ...quiet, readRatio: 0.6, activeSeconds: 90 }, settings)).toBe(
      "read_invite",
    );
  });

  it("prefers the pricing nudge, then exit intent, then the greeting", () => {
    const all = {
      ...quiet,
      pricingTouched: true,
      exitIntent: true,
      returning: true,
      activeSeconds: 30,
    };
    expect(pickNudge(all, settings)).toBe("pricing");
    expect(pickNudge({ ...all, pricingTouched: false }, settings)).toBe("exit_intent");
    expect(pickNudge({ ...all, pricingTouched: false, exitIntent: false }, settings)).toBe(
      "returning",
    );
  });

  it("greets returning visitors only after they arrived", () => {
    expect(pickNudge({ ...quiet, returning: true, activeSeconds: 5 }, settings)).toBeNull();
  });

  it("shows at most one nudge and none while the chat is open", () => {
    const signal = { ...quiet, pricingTouched: true };
    expect(pickNudge({ ...signal, shown: true }, settings)).toBeNull();
    expect(pickNudge({ ...signal, chatOpen: true }, settings)).toBeNull();
  });

  it("respects the workspace settings", () => {
    const signal = { ...quiet, pricingTouched: true };
    expect(pickNudge(signal, { ...settings, pricing: false })).toBeNull();
    expect(pickNudge(signal, { ...settings, enabled: false })).toBeNull();
  });
});

describe("nudge helpers", () => {
  it("words the action for chat or the contact block", () => {
    const withChat = nudgeCopy("read_invite", {
      responseTime: "Ich antworte schnell.",
      chat: true,
    });
    expect(withChat).toEqual({
      text: "Fragen dazu? Ich antworte schnell.",
      action: "Frage stellen",
    });
    expect(nudgeCopy("pricing", { responseTime: "", chat: false }).action).toBe(
      "Kontakt aufnehmen",
    );
  });

  it("detects a fast scroll back up", () => {
    expect(isFastScrollUp(-600, 200)).toBe(true);
    expect(isFastScrollUp(-600, 1000)).toBe(false);
    expect(isFastScrollUp(-200, 50)).toBe(false);
    expect(isFastScrollUp(600, 100)).toBe(false);
  });

  it("shows the sticky bar after the first third", () => {
    expect(showStickyBar(0.3, settings)).toBe(false);
    expect(showStickyBar(0.34, settings)).toBe(true);
    expect(showStickyBar(0.9, { ...settings, stickyBar: false })).toBe(false);
  });

  it("lists the chosen options in the offer request", () => {
    expect(offerRequestText(["Website", "Online-Bestellung"])).toBe(
      "Bitte schicken Sie mir ein konkretes Angebot für: Website, Online-Bestellung.",
    );
    expect(offerRequestText([])).toBe("Bitte schicken Sie mir ein konkretes Angebot.");
  });
});
