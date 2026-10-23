import type { VatCheckPort } from "../types";

/**
 * Offline VIES for tests and development: ids ending in 0 are invalid, ids
 * containing 999 count as an unavailable member state, every other id is
 * valid and gets a consultation number when a requester UID is given.
 */
export function fakeVatCheck(): VatCheckPort {
  return {
    id: "fake",
    async check({ vatId, requesterVatId }) {
      if (vatId.includes("999")) throw new Error("VIES unavailable (fake)");
      const valid = !vatId.endsWith("0");
      return {
        valid,
        name: valid ? "Testfirma GmbH" : null,
        address: null,
        consultationNumber: valid && requesterVatId ? `WAPIAAAA${vatId.slice(-6)}` : null,
        checkedAt: new Date(),
      };
    },
  };
}
