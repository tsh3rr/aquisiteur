import { describe, expect, it, vi } from "vitest";
import { VIES_URL, viesVatCheck } from "./vat-check";

const answer = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("viesVatCheck", () => {
  it("sends both UIDs split into country and number and maps the answer", async () => {
    const fetch = answer({
      valid: true,
      name: "Huber GmbH",
      address: "---",
      requestIdentifier: "WAPIAAAAX1",
    });
    const result = await viesVatCheck({ fetch }).check({
      vatId: "de 123 456 789",
      requesterVatId: "ATU12345678",
    });
    expect(result).toMatchObject({
      valid: true,
      name: "Huber GmbH",
      address: null,
      consultationNumber: "WAPIAAAAX1",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(VIES_URL);
    expect(JSON.parse(String(init!.body))).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
      requesterMemberStateCode: "AT",
      requesterNumber: "U12345678",
    });
  });

  it("reports an invalid UID", async () => {
    const result = await viesVatCheck({ fetch: answer({ valid: false }) }).check({
      vatId: "DE000000000",
      requesterVatId: null,
    });
    expect(result.valid).toBe(false);
  });

  it("throws when the member state service is down or VIES fails", async () => {
    const check = (fetch: typeof globalThis.fetch) =>
      viesVatCheck({ fetch }).check({ vatId: "DE123456789", requesterVatId: null });
    await expect(check(answer({ errorWrappers: "MS_UNAVAILABLE" }))).rejects.toThrow(
      /MS_UNAVAILABLE/,
    );
    await expect(check(answer({}, 500))).rejects.toThrow(/500/);
  });
});
