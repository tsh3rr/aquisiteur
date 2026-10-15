import { describe, expect, it } from "vitest";
import { fieldErrors, profileStepSchema, senderStepSchema } from "./onboarding";

describe("onboarding schemas", () => {
  it("accepts a complete profile and drops empty optional fields", () => {
    const result = profileStepSchema.parse({
      profile: { displayName: "Jeremiasz Kapek", role: "" },
      channels: { email: "hallo@agentur.de", phone: "", mobile: "+49 170 1234567", whatsapp: "" },
    });
    expect(result.profile.role).toBeUndefined();
    expect(result.channels.phone).toBeUndefined();
    expect(result.channels.mobile).toBe("+49 170 1234567");
  });

  it("reports field paths for invalid input", () => {
    const result = profileStepSchema.safeParse({
      profile: { displayName: "J" },
      channels: { email: "nope", phone: "abc" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual([
        "channels.email",
        "channels.phone",
        "profile.displayName",
      ]);
    }
  });

  it("validates German postal codes and custom domains", () => {
    const base = {
      senderAddress: {
        company: "Pixelwerk",
        street: "Karl-Liebknecht-Str. 1",
        postalCode: "04107",
        city: "Leipzig",
      },
    };
    expect(senderStepSchema.safeParse({ ...base, customDomain: "go.pixelwerk.de" }).success).toBe(
      true,
    );
    expect(senderStepSchema.safeParse({ ...base, customDomain: "" }).success).toBe(true);
    expect(
      senderStepSchema.safeParse({ ...base, customDomain: "https://pixelwerk.de" }).success,
    ).toBe(false);
    expect(
      senderStepSchema.safeParse({
        ...base,
        senderAddress: { ...base.senderAddress, postalCode: "4107" },
      }).success,
    ).toBe(false);
  });
});
