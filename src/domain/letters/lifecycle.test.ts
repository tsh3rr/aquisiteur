import { describe, expect, it } from "vitest";
import { canTransition, isFinal, pathTo } from "./lifecycle";

describe("letter lifecycle", () => {
  it("walks the happy path when marking a draft as posted", () => {
    expect(pathTo("draft", "posted")).toEqual(["queued", "submitted", "printed", "posted"]);
    expect(pathTo("printed", "posted")).toEqual(["posted"]);
    expect(pathTo("posted", "posted")).toEqual([]);
  });

  it("does not go backwards or leave a final state", () => {
    expect(pathTo("posted", "draft")).toBeNull();
    expect(pathTo("cancelled", "posted")).toBeNull();
    expect(canTransition("posted", "returned")).toBe(true);
    expect(canTransition("posted", "cancelled")).toBe(false);
    expect(isFinal("returned")).toBe(true);
  });

  it("reaches side exits directly", () => {
    expect(pathTo("draft", "cancelled")).toEqual(["cancelled"]);
    expect(pathTo("submitted", "failed")).toEqual(["failed"]);
  });
});
