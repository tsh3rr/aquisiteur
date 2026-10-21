import { describe, expect, it } from "vitest";
import { consentBodySchema, replayChunkKey, replayChunkSchema, spanOf } from "./replay";

describe("session replay", () => {
  it("keeps chunks under the workspace prefix", () => {
    expect(replayChunkKey("ws", "r1", 7)).toBe("ws/replays/r1/0007.json.gz");
  });

  it("accepts rrweb events and refuses anything else", () => {
    const token = "t".repeat(30);
    expect(
      replayChunkSchema.safeParse({
        token,
        events: [{ type: 2, timestamp: 1, data: { node: {} } }],
      }).success,
    ).toBe(true);
    expect(replayChunkSchema.safeParse({ token, events: [{ type: "x" }] }).success).toBe(false);
    expect(replayChunkSchema.safeParse({ token, events: [] }).success).toBe(false);
  });

  it("measures the recorded span", () => {
    const events = [
      { type: 3, timestamp: 2_000 },
      { type: 3, timestamp: 5_500 },
    ];
    expect(spanOf(events, null)).toBe(3_500);
    expect(spanOf(events, 1_000)).toBe(4_500);
  });

  it("reads a decision without scope as the recording", () => {
    const token = "t".repeat(30);
    const old = consentBodySchema.parse({ token, decision: "given", version: "2026-10" });
    expect(old.scope).toBe("replay");
    const statistics = consentBodySchema.parse({
      token,
      scope: "statistics",
      decision: "denied",
      version: "2026-10-21",
    });
    expect(statistics.scope).toBe("statistics");
    expect(
      consentBodySchema.safeParse({ token, scope: "ads", decision: "given", version: "x" }).success,
    ).toBe(false);
  });
});
