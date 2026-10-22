import { type BillingSettings, taxNote } from "../billing";
import type { BlockOf } from "../expose/schema";
import { BILLING_LABELS, INTERVAL_MONTHS, type OfferDocument } from "./schema";
import { defaultVariantId, formatCents, lineFor, roundCents, variantItems } from "./totals";

type PricingBlock = BlockOf<"pricing">;
type PricingOption = PricingBlock["options"][number];

/**
 * The exposé's pricing block filled from an offer (§7.10 „Exposé-Anbindung“):
 * the lines of the recommended variant, each as one option with its line
 * total. The block only knows one-off and monthly prices, so quarterly to
 * yearly lines show their monthly equivalent and name the real billing.
 * The Gesamtrabatt goes into each one-off price, so the exposé's sum matches.
 */
export function pricingOptionsFromOffer(offer: OfferDocument): PricingOption[] {
  return variantItems(offer, defaultVariantId(offer))
    .slice(0, 12)
    .map((item) => {
      const line = lineFor(item);
      const recurring = line.billing !== "once" && line.billing !== "monthly";
      const months = recurring ? INTERVAL_MONTHS[line.billing as keyof typeof INTERVAL_MONTHS] : 1;
      const discounted = line.billing === "once" && offer.discountPercent > 0;
      const billingNote = recurring
        ? `Abrechnung ${BILLING_LABELS[line.billing]} (${formatCents(line.netCents)})`
        : discounted
          ? `inkl. ${String(offer.discountPercent).replace(".", ",")} % Gesamtrabatt`
          : undefined;
      const cents = discounted
        ? roundCents((line.netCents * (100 - offer.discountPercent)) / 100)
        : line.netCents;
      const description = [item.description, billingNote].filter(Boolean).join(" · ").slice(0, 400);
      return {
        id: item.id,
        title: item.title.slice(0, 120),
        ...(description ? { description } : {}),
        price: Math.round(cents / months) / 100,
        billing: line.billing === "once" ? "once" : "monthly",
        selected: item.optional ? item.selected : true,
        required: !item.optional,
      } satisfies PricingOption;
    });
}

/** Replaces the pricing block's options (and tax line) with the offer's; other fields stay. */
export function pricingBlockFromOffer(
  block: PricingBlock,
  offer: OfferDocument,
  billing: Pick<BillingSettings, "taxMode" | "smallBusinessNote">,
): PricingBlock {
  const options = pricingOptionsFromOffer(offer);
  if (options.length === 0) return block;
  return { ...block, options, vatNote: taxNote(billing).slice(0, 120) };
}
