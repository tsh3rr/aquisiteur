import type { VatCheckPort, VatCheckResult } from "../types";

/**
 * The European Commission's VIES REST service
 * (https://ec.europa.eu/taxation_customs/vies/). Only the two UIDs leave the
 * app. Greece is "EL" in VAT ids and in VIES.
 */
export const VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";

function split(vatId: string): { countryCode: string; vatNumber: string } {
  const clean = vatId.replace(/[\s.-]/g, "").toUpperCase();
  return { countryCode: clean.slice(0, 2), vatNumber: clean.slice(2) };
}

const blank = (value: unknown) =>
  typeof value === "string" && value.trim() && value.trim() !== "---" ? value.trim() : null;

export function viesVatCheck(
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): VatCheckPort {
  const doFetch = options.fetch ?? fetch;
  return {
    id: "vies",
    async check({ vatId, requesterVatId }): Promise<VatCheckResult> {
      const target = split(vatId);
      const requester = requesterVatId ? split(requesterVatId) : null;
      const response = await doFetch(VIES_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          ...target,
          ...(requester
            ? {
                requesterMemberStateCode: requester.countryCode,
                requesterNumber: requester.vatNumber,
              }
            : {}),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) throw new Error(`VIES answered ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      // Member state services that are down answer 200 with an error code.
      if (typeof body.valid !== "boolean") {
        throw new Error(`VIES: ${String(body.errorWrappers ?? body.userError ?? "no answer")}`);
      }
      return {
        valid: body.valid,
        name: blank(body.name),
        address: blank(body.address),
        consultationNumber: blank(body.requestIdentifier),
        checkedAt: new Date(),
      };
    },
  };
}
