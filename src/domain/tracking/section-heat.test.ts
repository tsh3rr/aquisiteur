import { describe, expect, it } from "vitest";
import { sectionHeat } from "./section-heat";

describe("sectionHeat", () => {
  it("sums reading time per section in exposé order, real visits only", () => {
    const outline = {
      blocks: new Map([
        ["hero", "Einstieg"],
        ["preise", "Preise"],
        ["kontakt", "Kontakt"],
      ]),
      pricingOptions: new Map(),
    };
    const dwell = (visitId: string, blockId: string, seconds: number) => ({
      visitId,
      type: "section_dwell",
      blockId,
      payload: { seconds },
    });
    const heat = sectionHeat(
      outline,
      [
        dwell("a", "preise", 30),
        dwell("a", "preise", 10),
        dwell("b", "preise", 5),
        dwell("bot", "hero", 99),
        { visitId: "a", type: "section_view", blockId: "hero", payload: {} },
      ],
      new Set(["a", "b"]),
    );
    expect(heat).toEqual([
      { blockId: "hero", name: "Einstieg", seconds: 0, visits: 0 },
      { blockId: "preise", name: "Preise", seconds: 45, visits: 2 },
      { blockId: "kontakt", name: "Kontakt", seconds: 0, visits: 0 },
    ]);
  });
});
