import { describe, expect, it } from "vitest";
import { slugify, validateSlug } from "./slug";

describe("slugify()", () => {
  it.each([
    ["Pixelwerk Leipzig", "pixelwerk-leipzig"],
    ["Café Müller & Söhne", "cafe-mueller-soehne"],
    ["  Straßenbau GmbH ", "strassenbau-gmbh"],
    ["---", ""],
    ["Ünïcödé Ågency", "uenicoede-aagency"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps the length at 40 without a trailing dash", () => {
    const slug = slugify("a".repeat(39) + " bcd");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("validateSlug()", () => {
  it("accepts valid DNS labels", () => {
    expect(validateSlug("pixelwerk")).toBeNull();
    expect(validateSlug("agentur-42")).toBeNull();
  });

  it.each([
    ["ab", "too_short"],
    ["a".repeat(41), "too_long"],
    ["-abc", "invalid_chars"],
    ["abc-", "invalid_chars"],
    ["ABC", "invalid_chars"],
    ["app", "reserved"],
    ["www", "reserved"],
  ])("%s is rejected as %s", (slug, problem) => {
    expect(validateSlug(slug)).toBe(problem);
  });
});
