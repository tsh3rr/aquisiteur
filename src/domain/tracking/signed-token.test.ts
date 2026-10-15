import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "./signed-token";

const SECRET = "test-secret-test-secret-test-secret";
const ID = "5b0c4f39-2f7e-4d55-9a6c-6c0d6f3c1a11";

describe("signed tracking tokens", () => {
  it("round-trips an id until it expires", async () => {
    const now = Date.UTC(2026, 9, 15, 12);
    const token = await signToken(SECRET, "visit", ID, 60, now);
    expect(await verifyToken(SECRET, "visit", token, now + 59_000)).toBe(ID);
    expect(await verifyToken(SECRET, "visit", token, now + 61_000)).toBeNull();
  });

  it("rejects other purposes, other secrets and tampering", async () => {
    const token = await signToken(SECRET, "ticket", ID, 600);
    expect(await verifyToken(SECRET, "visit", token)).toBeNull();
    expect(await verifyToken(`${SECRET}x`, "ticket", token)).toBeNull();
    const [, expires, signature] = token.split(".");
    const forged = `00000000-0000-0000-0000-000000000000.${expires}.${signature}`;
    expect(await verifyToken(SECRET, "ticket", forged)).toBeNull();
    expect(await verifyToken(SECRET, "ticket", "garbage")).toBeNull();
  });
});
