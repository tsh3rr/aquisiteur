import { describe, expect, it } from "vitest";
import { parseEvents } from "./events";

describe("event schema", () => {
  it("keeps valid events and drops malformed or unknown ones", () => {
    const events = parseEvents([
      { type: "page_view", at: 0 },
      { type: "section_dwell", at: 5000, blockId: "preise", seconds: 12 },
      { type: "section_dwell", at: 5000, blockId: "preise", seconds: 1 },
      { type: "contact_click", at: 9000, channel: "fax" },
      { type: "keylogger", at: 1, keys: "secret" },
      { type: "scroll_depth", at: 100, percent: 70, extra: "ignored" },
      "nonsense",
    ]);
    expect(events).toEqual([
      { type: "page_view", at: 0 },
      { type: "section_dwell", at: 5000, blockId: "preise", seconds: 12 },
      { type: "scroll_depth", at: 100, percent: 70 },
    ]);
  });
});
