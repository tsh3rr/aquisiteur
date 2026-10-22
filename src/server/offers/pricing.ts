import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import { assets, exposes, exposeVersions, offers, offerVersions } from "@/db/schema";
import type { BlockOf, ExposeDocument } from "@/domain/expose/schema";
import { pricingBlockFromOffer } from "@/domain/offers/to-pricing";
import { offerDocumentSchema, type OfferDocument } from "@/domain/offers/schema";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Exposé ↔ offer (§7.10 „Exposé-Anbindung“). Runs inside withTenant. */

/**
 * The offer an exposé of the project shows: the accepted one, else the most
 * recently changed sent one, in its sent version. Drafts never go public on
 * their own; „Ins Exposé übernehmen“ is the explicit way for them.
 */
export async function currentProjectOffer(
  tx: Transaction,
  workspaceId: string,
  projectId: string,
): Promise<OfferDocument | null> {
  const [row] = await tx
    .select({ document: offerVersions.document })
    .from(offers)
    .innerJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, offers.currentVersionId),
      ),
    )
    .where(
      and(
        eq(offers.workspaceId, workspaceId),
        eq(offers.projectId, projectId),
        inArray(offers.status, ["accepted", "sent"]),
      ),
    )
    .orderBy(sql`${offers.status} = 'accepted' desc`, desc(offers.updatedAt))
    .limit(1);
  if (!row) return null;
  const parsed = offerDocumentSchema.safeParse(row.document);
  return parsed.success ? parsed.data : null;
}

function replacePricing(
  document: ExposeDocument,
  offer: OfferDocument,
  billing: Parameters<typeof pricingBlockFromOffer>[2],
  onlySourced: boolean,
): ExposeDocument {
  return {
    ...document,
    blocks: document.blocks.map((block) =>
      block.type === "pricing" && (!onlySourced || block.source === "offer")
        ? { ...pricingBlockFromOffer(block, offer, billing), source: "offer" as const }
        : block,
    ),
  };
}

/** Fills pricing blocks marked `"source": "offer"` from the project's offer, if there is one. */
export async function withOfferPricing(
  tx: Transaction,
  workspaceId: string,
  projectId: string,
  document: ExposeDocument,
): Promise<ExposeDocument> {
  if (!document.blocks.some((block) => block.type === "pricing" && block.source === "offer")) {
    return document;
  }
  const offer = await currentProjectOffer(tx, workspaceId, projectId);
  if (!offer || offer.items.length === 0) return document;
  const { billing } = await loadWorkspaceSettings(tx, workspaceId);
  return replacePricing(document, offer, billing, true);
}

/**
 * „Ins Exposé übernehmen“: the current exposé document of every exposé in the
 * offer's project with its pricing blocks taken from the offer; a document
 * without a pricing block gets one before the contact block. The caller
 * publishes it as a new version with the assets it already had.
 */
export async function exposesWithOfferPricing(
  tx: Transaction,
  workspaceId: string,
  offerId: string,
): Promise<
  { exposeId: string; document: ExposeDocument; assets: { path: string; sha256: string }[] }[]
> {
  const [offer] = await tx
    .select({ projectId: offers.projectId, draft: offers.draft, document: offerVersions.document })
    .from(offers)
    .leftJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, offers.currentVersionId),
      ),
    )
    .where(and(eq(offers.workspaceId, workspaceId), eq(offers.id, offerId)));
  if (!offer) return [];
  const parsed = offerDocumentSchema.safeParse(offer.document ?? offer.draft);
  if (!parsed.success || parsed.data.items.length === 0) return [];
  const { billing } = await loadWorkspaceSettings(tx, workspaceId);
  const rows = await tx
    .select({
      exposeId: exposes.id,
      document: exposeVersions.document,
      manifest: exposeVersions.assetManifest,
    })
    .from(exposes)
    .innerJoin(
      exposeVersions,
      and(
        eq(exposeVersions.workspaceId, exposes.workspaceId),
        eq(exposeVersions.id, exposes.currentVersionId),
      ),
    )
    .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.projectId, offer.projectId)));
  const result = [];
  for (const row of rows) {
    const current = row.document as ExposeDocument;
    const hasPricing = current.blocks.some((block) => block.type === "pricing");
    const withBlock: ExposeDocument = hasPricing ? current : insertPricingBlock(current);
    const document = replacePricing(withBlock, parsed.data, billing, false);
    const assetIds = Object.values(row.manifest).map((entry) => entry.assetId);
    const hashes =
      assetIds.length === 0
        ? []
        : await tx
            .select({ id: assets.id, sha256: assets.sha256 })
            .from(assets)
            .where(and(eq(assets.workspaceId, workspaceId), inArray(assets.id, assetIds)));
    const shaById = new Map(hashes.map((asset) => [asset.id, asset.sha256]));
    result.push({
      exposeId: row.exposeId,
      document,
      assets: Object.entries(row.manifest).map(([path, entry]) => ({
        path,
        sha256: shaById.get(entry.assetId) ?? "",
      })),
    });
  }
  return result;
}

function insertPricingBlock(document: ExposeDocument): ExposeDocument {
  const taken = new Set(document.blocks.map((block) => block.id));
  let id = "preise";
  for (let n = 2; taken.has(id); n++) id = `preise-${n}`;
  const block: BlockOf<"pricing"> = {
    id,
    type: "pricing",
    title: "Ihr Angebot",
    currency: "EUR",
    vatNote: "Alle Preise netto zzgl. gesetzlicher USt.",
    source: "offer",
    options: [
      {
        id: "platzhalter",
        title: "Platzhalter",
        price: 0,
        billing: "once",
        selected: true,
        required: true,
      },
    ],
  };
  const contact = document.blocks.findIndex((entry) => entry.type === "contact");
  const blocks = [...document.blocks];
  blocks.splice(contact === -1 ? blocks.length : contact, 0, block);
  return { ...document, blocks };
}
