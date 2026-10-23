import "server-only";
import type { BillingProfile } from "@/domain/invoices/schema";
import { getInfra } from "@/infra";

export type VatCheckOutcome =
  | { status: "valid" | "invalid"; check: NonNullable<BillingProfile["vatCheck"]> }
  | { status: "unavailable" | "off" };

/**
 * Asks VIES about a customer's UID (§7.10, 7c). Never throws: an unavailable
 * member state is a normal answer the profile form explains.
 */
export async function checkVatId(
  vatId: string,
  requesterVatId: string | null | undefined,
): Promise<VatCheckOutcome> {
  const port = getInfra().vatCheck;
  if (!port) return { status: "off" };
  try {
    const result = await port.check({ vatId, requesterVatId });
    return {
      status: result.valid ? "valid" : "invalid",
      check: {
        vatId,
        valid: result.valid,
        checkedAt: result.checkedAt.toISOString(),
        name: result.name,
        consultationNumber: result.consultationNumber,
      },
    };
  } catch (error) {
    console.warn("VIES check failed", error instanceof Error ? error.message : error);
    return { status: "unavailable" };
  }
}
