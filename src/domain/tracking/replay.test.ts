import { describe, expect, it } from "vitest";
import {
  REPLAY_NOTICE_VERSION,
  replayChunkKey,
  replayChunkSchema,
  spanOf,
  storedDecision,
} from "./replay";

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

  it("asks again when the notice changed", () => {
    expect(storedDecision(JSON.stringify({ v: REPLAY_NOTICE_VERSION, d: "given" }))).toBe("given");
    expect(storedDecision(JSON.stringify({ v: "old", d: "given" }))).toBeNull();
    expect(storedDecision("{broken")).toBeNull();
    expect(storedDecision(null)).toBeNull();
  });
});
