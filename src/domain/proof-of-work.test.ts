import { describe, expect, it } from "vitest";
import { POW_MAX, powChallengeId, powParts, powSolves, solvePow } from "./proof-of-work";

const visit = "v0b5c3d7e-1111-4222-8333-944445555666";
const random = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe("proof of work", () => {
  it("builds a challenge id that binds the subject into the salt", async () => {
    const id = await powChallengeId(visit, random, 42);
    expect(powParts(id)).toEqual({
      subject: visit,
      salt: `${visit}~0102030405060708`,
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("accepts only the secret number", async () => {
    const id = await powChallengeId(visit, random, 42);
    expect(await powSolves(id, 42)).toBe(true);
    expect(await powSolves(id, 41)).toBe(false);
    expect(await powSolves(id, -1)).toBe(false);
    expect(await powSolves(id, POW_MAX)).toBe(false);
    expect(await powSolves(id, 4.2)).toBe(false);
  });

  it("rejects malformed ids", () => {
    expect(powParts("x~y~z")).toBeNull();
    expect(powParts(`${visit}~0102030405060708`)).toBeNull();
    expect(powParts(`q${visit.slice(1)}~0102030405060708~${"a".repeat(64)}`)).toBeNull();
  });

  it("the browser search finds the number", async () => {
    const id = await powChallengeId(visit, random, 1234);
    const solution = await solvePow({ pow: `${id}.exp.sig`, max: 5000 });
    expect(solution).toEqual({ pow: `${id}.exp.sig`, number: 1234 });
  });

  it("stops when aborted", async () => {
    const id = await powChallengeId(visit, random, 4999);
    const controller = new AbortController();
    controller.abort();
    expect(await solvePow({ pow: `${id}.e.s`, max: 5000 }, controller.signal)).toBeNull();
  });
});
