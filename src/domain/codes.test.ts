import { describe, expect, it } from "vitest";
import { bearerToken, generateApiToken, hashApiToken } from "./api-tokens";
import { exposeSlug, randomCode, refCode, UNAMBIGUOUS_ALPHABET } from "./codes";
import { parseVariantFileName, sniffFormat } from "./expose/asset-files";

describe("random codes", () => {
  it("only uses unambiguous characters", () => {
    const code = randomCode(500);
    expect(code).toHaveLength(500);
    expect([...code].every((char) => UNAMBIGUOUS_ALPHABET.includes(char))).toBe(true);
    expect(code).not.toMatch(/[01ilo]/);
  });

  it("builds slugs and ref codes", () => {
    expect(exposeSlug("cafe-mueller")).toMatch(/^cafe-mueller-[2-9a-z]{10}$/);
    expect(refCode()).toMatch(/^[2-9A-Z]{4}$/);
    expect(refCode()).not.toMatch(/[01ILO]/);
  });
});

describe("API tokens", () => {
  it("generates, hashes and parses tokens", async () => {
    const { token, prefix } = generateApiToken();
    expect(token).toMatch(/^aq_[0-9A-Za-z]{32}$/);
    expect(token.startsWith(prefix)).toBe(true);
    expect(await hashApiToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashApiToken(token)).not.toBe(await hashApiToken(generateApiToken().token));
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer  ${token}`)).toBe(token);
    expect(bearerToken("Bearer nope")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
});

describe("asset files", () => {
  const bytes = (text: string, prefix: number[] = []) =>
    new Uint8Array([...prefix, ...new TextEncoder().encode(text)]);

  it("sniffs formats from magic bytes", () => {
    expect(sniffFormat(bytes("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(sniffFormat(bytes("\0\0\0\x1cftypavif"))).toBe("avif");
    expect(sniffFormat(bytes("\0\0\0\x1cftypisom"))).toBe("mp4");
    expect(sniffFormat(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe("webm");
    expect(sniffFormat(bytes("WEBVTT\n\n00:00.000"))).toBe("vtt");
    expect(sniffFormat(bytes("WEBVTT", [0xef, 0xbb, 0xbf]))).toBe("vtt");
    expect(sniffFormat(bytes("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffFormat(bytes("<html>"))).toBeNull();
  });

  it("parses variant file names strictly", () => {
    expect(parseVariantFileName("960.avif")).toEqual({ format: "avif", width: 960 });
    expect(parseVariantFileName("file.vtt")).toEqual({ format: "vtt", width: null });
    expect(parseVariantFileName("../x.avif")).toBeNull();
    expect(parseVariantFileName("960.svg")).toBeNull();
  });
});
