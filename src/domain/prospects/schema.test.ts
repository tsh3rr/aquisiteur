import { describe, expect, it } from "vitest";
import { fieldErrors, prospectFormSchema } from "./schema";

describe("prospect form", () => {
  it("trims, nulls empty fields, splits tags and parses euro amounts", () => {
    const parsed = prospectFormSchema.parse({
      companyName: "  Café Müller ",
      city: " ",
      website: "https://cafe-mueller.example",
      tags: "Café, leipzig ,café,",
      estimatedValue: "4.700,50 €",
    });
    expect(parsed).toMatchObject({
      companyName: "Café Müller",
      city: null,
      email: null,
      tags: ["café", "leipzig"],
      estimatedValue: 470050,
    });
  });

  it("reports readable German errors per field", () => {
    const result = prospectFormSchema.safeParse({
      companyName: "",
      website: "cafe-mueller",
      email: "kein-at",
      estimatedValue: "viel",
    });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({
      companyName: "Bitte den Firmennamen angeben.",
      website: "Bitte eine vollständige Adresse mit https:// angeben.",
      email: "Bitte eine gültige E-Mail-Adresse angeben.",
      estimatedValue: "Bitte einen Betrag in Euro angeben.",
    });
  });
});
