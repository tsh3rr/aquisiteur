import { describe, expect, it } from "vitest";
import { knownPhones, maskPhone, normalizePhone } from "./known-phones";

const contactId = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("normalizePhone", () => {
  it("keeps digits and a leading plus", () => {
    expect(normalizePhone("+49 (170) 123-4567")).toBe("+491701234567");
    expect(normalizePhone("0049 170 1234567")).toBe("+491701234567");
    expect(normalizePhone("0341 / 1234567")).toBe("03411234567");
  });

  it("rejects text and numbers that are too short", () => {
    expect(normalizePhone("ruf mich an")).toBeNull();
    expect(normalizePhone("0341 12")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("shows prefix and the last two digits only", () => {
    expect(maskPhone("+49 170 1234567")).toBe("+49 170 ••• 67");
    expect(maskPhone("0170 1234567")).toBe("0170 ••• 67");
    expect(maskPhone("0341 1234589")).toBe("0341 ••• 89");
  });

  it("never contains the hidden digits", () => {
    const masked = maskPhone("+49 170 9876543")!;
    expect(masked).not.toMatch(/9876|8765|7654|6543/);
  });

  it("returns null for unusable input", () => {
    expect(maskPhone("")).toBeNull();
    expect(maskPhone("123")).toBeNull();
  });
});

describe("knownPhones", () => {
  it("offers prospect and contact numbers once each", () => {
    expect(
      knownPhones([
        { ref: "p", phone: "0341 1234567" },
        { ref: contactId, phone: "+49 341 1234567" },
        { ref: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", phone: "0170 7654321" },
      ]),
    ).toEqual([
      { ref: "p", masked: "0341 ••• 67" },
      { ref: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", masked: "0170 ••• 21" },
    ]);
  });

  it("skips missing, invalid and unreferenced numbers", () => {
    expect(
      knownPhones([
        { ref: "p", phone: null },
        { ref: contactId, phone: "kein Telefon" },
        { ref: "other", phone: "0341 1234567" },
      ]),
    ).toEqual([]);
  });

  it("offers at most three numbers", () => {
    const sources = Array.from({ length: 5 }, (_, i) => ({
      ref: contactId.replace(/b$/, String(i)),
      phone: `0170 123456${i}`,
    }));
    expect(knownPhones(sources)).toHaveLength(3);
  });
});
