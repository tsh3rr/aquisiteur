import { describe, expect, it, vi } from "vitest";
import { nominatimGeocoder } from "./geocoder";

describe("nominatimGeocoder", () => {
  it("asks for one structured result and identifies itself", async () => {
    const fetch = vi.fn(async () =>
      Response.json([{ lat: "51.3397", lon: "12.3731" }]),
    ) as unknown as typeof globalThis.fetch;
    const geocoder = nominatimGeocoder({ appUrl: "https://app.example", contact: "a@b.de", fetch });
    const point = await geocoder.geocode({
      street: "Markt 1",
      postalCode: "04109",
      city: "Leipzig",
      country: "DE",
    });
    expect(point).toEqual({ latitude: 51.3397, longitude: 12.3731 });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toContain("street=Markt+1");
    expect(String(url)).toContain("postalcode=04109");
    expect(String(url)).toContain("countrycodes=de");
    expect(String(url)).toContain("limit=1");
    expect((init as RequestInit).headers).toMatchObject({
      "user-agent": "Aquisiteur/1.0 (+https://app.example; a@b.de)",
    });
  });

  it("returns null for no hit and throws on errors", async () => {
    const empty = nominatimGeocoder({
      appUrl: "https://app.example",
      fetch: (async () => Response.json([])) as typeof fetch,
    });
    await expect(
      empty.geocode({ street: null, postalCode: null, city: "Nirgendwo", country: "DE" }),
    ).resolves.toBeNull();
    const failing = nominatimGeocoder({
      appUrl: "https://app.example",
      fetch: (async () => new Response("", { status: 429 })) as typeof fetch,
    });
    await expect(
      failing.geocode({ street: null, postalCode: null, city: "Leipzig", country: "DE" }),
    ).rejects.toThrow("429");
  });
});
