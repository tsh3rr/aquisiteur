import "server-only";
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  auditLog,
  catalogItems,
  numberSeries,
  offers,
  offerVersions,
  projects,
  prospects,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { taxNote, type TaxMode } from "@/domain/billing";
import { addDays, canonicalJson, seriesNumber } from "@/domain/offers/acceptance";
import {
  displayStatus,
  offerDocumentSchema,
  type OfferDocument,
  type OfferStatus,
  sendIssues,
} from "@/domain/offers/schema";
import { defaultSelection, offerTotals, paymentPlan } from "@/domain/offers/totals";
import { randomCode } from "@/domain/codes";
import { localDateString } from "@/domain/tasks";
import { sha256Hex } from "@/lib/crypto";
import { publish, workspaceTopic } from "@/server/realtime";
import { advanceProject } from "@/server/projects";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Offers in the cockpit (§7.10). Every function runs inside withTenant. */

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** 22 base62 characters ≈ 131 bits: the public link cannot be guessed (§10). */
export function offerToken(): string {
  return randomCode(22, BASE62);
}

export interface OfferListItem {
  id: string;
  projectId: string;
  projectName: string;
  prospectId: string;
  company: string;
  number: string | null;
  title: string;
  status: OfferStatus | "expired";
  version: number | null;
  validUntil: string | null;
  sentAt: Date | null;
  firstViewedAt: Date | null;
  viewCount: number;
  answeredAt: Date | null;
  /** One-off total of the default selection of the current version (or the draft). */
  onceCents: number;
  monthlyCents: number;
  updatedAt: Date;
}

async function today(tx: Transaction, workspaceId: string, now: Date) {
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  return { settings, date: localDateString(now, settings.notifications.timezone) };
}

/** Offers of a project, a customer or the whole workspace, newest first. */
export async function listOffers(
  tx: Transaction,
  workspaceId: string,
  filter: { projectId?: string; prospectId?: string; open?: boolean } = {},
  now = new Date(),
): Promise<OfferListItem[]> {
  const rows = await tx
    .select({
      offer: offers,
      projectName: projects.name,
      company: prospects.companyName,
      version: offerVersions.version,
      document: offerVersions.document,
      taxMode: offerVersions.taxMode,
      validUntil: offerVersions.validUntil,
    })
    .from(offers)
    .innerJoin(
      projects,
      and(eq(projects.workspaceId, offers.workspaceId), eq(projects.id, offers.projectId)),
    )
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, offers.workspaceId), eq(prospects.id, offers.prospectId)),
    )
    .leftJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, offers.currentVersionId),
      ),
    )
    .where(
      and(
        eq(offers.workspaceId, workspaceId),
        filter.projectId ? eq(offers.projectId, filter.projectId) : undefined,
        filter.prospectId ? eq(offers.prospectId, filter.prospectId) : undefined,
        filter.open ? inArray(offers.status, ["draft", "sent"]) : undefined,
      ),
    )
    .orderBy(desc(offers.updatedAt))
    .limit(300);
  const { settings, date } = await today(tx, workspaceId, now);
  return rows.map((row) => {
    const document = row.document ?? row.offer.draft;
    const mode = (row.taxMode as TaxMode | null) ?? settings.billing.taxMode;
    const totals = offerTotals(document, defaultSelection(document), mode);
    return {
      id: row.offer.id,
      projectId: row.offer.projectId,
      projectName: row.projectName,
      prospectId: row.offer.prospectId,
      company: row.company,
      number: row.offer.number,
      title: row.offer.title,
      status: displayStatus(row.offer.status, row.validUntil, date),
      version: row.version,
      validUntil: row.validUntil,
      sentAt: row.offer.sentAt,
      firstViewedAt: row.offer.firstViewedAt,
      viewCount: row.offer.viewCount,
      answeredAt: row.offer.answeredAt,
      onceCents: totals.buckets.once?.totalCents ?? 0,
      monthlyCents: totals.buckets.monthly?.totalCents ?? 0,
      updatedAt: row.offer.updatedAt,
    };
  });
}

/** Everything the editor needs: the draft, the versions and the project context. */
export async function loadOffer(
  tx: Transaction,
  workspaceId: string,
  offerId: string,
  now = new Date(),
) {
  const [row] = await tx
    .select({
      offer: offers,
      projectName: projects.name,
      company: prospects.companyName,
    })
    .from(offers)
    .innerJoin(
      projects,
      and(eq(projects.workspaceId, offers.workspaceId), eq(projects.id, offers.projectId)),
    )
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, offers.workspaceId), eq(prospects.id, offers.prospectId)),
    )
    .where(and(eq(offers.workspaceId, workspaceId), eq(offers.id, offerId)));
  if (!row) return null;
  const versions = await tx
    .select({
      id: offerVersions.id,
      version: offerVersions.version,
      validUntil: offerVersions.validUntil,
      sha256: offerVersions.sha256,
      taxMode: offerVersions.taxMode,
      createdAt: offerVersions.createdAt,
      document: offerVersions.document,
    })
    .from(offerVersions)
    .where(and(eq(offerVersions.workspaceId, workspaceId), eq(offerVersions.offerId, offerId)))
    .orderBy(desc(offerVersions.version));
  const { settings, date } = await today(tx, workspaceId, now);
  const current = versions.find((version) => version.id === row.offer.currentVersionId) ?? null;
  return {
    ...row.offer,
    projectName: row.projectName,
    company: row.company,
    versions,
    current,
    displayStatus: displayStatus(row.offer.status, current?.validUntil ?? null, date),
    /** The draft differs from what the customer sees. */
    changedSinceSent:
      current !== null && canonicalJson(current.document) !== canonicalJson(row.offer.draft),
    billing: settings.billing,
  };
}

async function changed(workspaceId: string, offerId: string, prospectId: string) {
  await publish([workspaceTopic(workspaceId)], "offer.changed", { offerId, prospectId });
}

/** A new draft in a project, prefilled with the workspace's texts and validity. */
export async function createOffer(
  tx: Transaction,
  actor: Actor,
  projectId: string,
  input: { title?: string; catalogItemIds?: string[] } = {},
): Promise<string | null> {
  const [project] = await tx
    .select({ id: projects.id, prospectId: projects.prospectId, name: projects.name })
    .from(projects)
    .where(and(eq(projects.workspaceId, actor.workspaceId), eq(projects.id, projectId)));
  if (!project) return null;
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const catalog =
    input.catalogItemIds && input.catalogItemIds.length > 0
      ? await tx
          .select()
          .from(catalogItems)
          .where(
            and(
              eq(catalogItems.workspaceId, actor.workspaceId),
              inArray(catalogItems.id, input.catalogItemIds),
            ),
          )
      : [];
  const draft = offerDocumentSchema.parse({
    title: input.title?.trim() || project.name,
    intro: settings.billing.offerIntro,
    outro: settings.billing.offerOutro,
    validDays: settings.billing.offerValidDays,
    items: catalog.map((item, index) => catalogLine(item, `pos-${index + 1}`)),
  });
  const [row] = await tx
    .insert(offers)
    .values({
      workspaceId: actor.workspaceId,
      projectId,
      prospectId: project.prospectId,
      title: draft.title,
      draft,
      publicToken: offerToken(),
      createdBy: actor.userId,
    })
    .returning({ id: offers.id });
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "offer.created",
    targetType: "offer",
    targetId: row!.id,
    meta: { prospectId: project.prospectId, projectId, title: draft.title },
  });
  return row!.id;
}

/** An offer line from a catalogue entry. */
export function catalogLine(item: typeof catalogItems.$inferSelect, id: string) {
  return {
    id,
    title: item.name,
    description: item.description ?? undefined,
    unit: item.unit,
    unitPriceCents: item.unitPriceCents,
    billing: item.billing,
    vatRate: ([20, 13, 10, 0] as const).find((rate) => rate === item.vatRate) ?? 20,
  };
}

export type SaveResult = { ok: true } | { ok: false; error: "not_found" | "locked" };

/** Saves the draft. Accepted and withdrawn offers are final. */
export async function saveOfferDraft(
  tx: Transaction,
  actor: Actor,
  offerId: string,
  draft: OfferDocument,
): Promise<SaveResult> {
  const [offer] = await tx
    .select({ status: offers.status, prospectId: offers.prospectId })
    .from(offers)
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
  if (!offer) return { ok: false, error: "not_found" };
  if (offer.status === "accepted" || offer.status === "withdrawn") {
    return { ok: false, error: "locked" };
  }
  await tx
    .update(offers)
    .set({ draft, title: draft.title })
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
  return { ok: true };
}

/** Next number of a series; one UPDATE … RETURNING, so concurrent sends never share one. */
export async function nextNumber(
  tx: Transaction,
  workspaceId: string,
  kind: "offer" | "invoice",
  year: number,
): Promise<number> {
  const [row] = await tx
    .insert(numberSeries)
    .values({ workspaceId, kind, year, last: 1 })
    .onConflictDoUpdate({
      target: [numberSeries.workspaceId, numberSeries.kind, numberSeries.year],
      set: { last: sql`${numberSeries.last} + 1` },
    })
    .returning({ last: numberSeries.last });
  return row!.last;
}

export type SendResult =
  | { ok: true; number: string; version: number; token: string }
  | { ok: false; error: "not_found" | "locked" | "invalid"; issues?: string[] };

/**
 * Sends the draft (§7.10): freezes it as a new version with a checksum,
 * assigns the offer number on the first send and starts the validity. The
 * public link stays the same; it always shows the latest version.
 */
export async function sendOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
  now = new Date(),
): Promise<SendResult> {
  const [offer] = await tx
    .select()
    .from(offers)
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)))
    .for("update");
  if (!offer) return { ok: false, error: "not_found" };
  if (offer.status === "accepted" || offer.status === "withdrawn") {
    return { ok: false, error: "locked" };
  }
  const parsed = offerDocumentSchema.safeParse(offer.draft);
  if (!parsed.success)
    return { ok: false, error: "invalid", issues: ["Der Entwurf ist unvollständig."] };
  const { settings, date } = await today(tx, actor.workspaceId, now);
  const issues = sendIssues(parsed.data);
  const once = offerTotals(parsed.data, defaultSelection(parsed.data), settings.billing.taxMode)
    .buckets.once;
  if (once && paymentPlan(parsed.data.paymentPlan, once.totalCents).overbooked) {
    issues.push(
      "Die Tranchen vor der letzten sind höher als die Summe. Bitte den Zahlungsplan anpassen.",
    );
  }
  if (issues.length > 0) return { ok: false, error: "invalid", issues };

  const year = Number(date.slice(0, 4));
  const number =
    offer.number ??
    seriesNumber("AN", year, await nextNumber(tx, actor.workspaceId, "offer", year));
  const [{ latest } = { latest: 0 }] = await tx
    .select({ latest: max(offerVersions.version) })
    .from(offerVersions)
    .where(eq(offerVersions.offerId, offerId));
  const version = (latest ?? 0) + 1;
  const validUntil = addDays(date, parsed.data.validDays);
  const frozen = {
    document: parsed.data,
    taxMode: settings.billing.taxMode,
    taxNote: taxNote(settings.billing),
    validUntil,
  };
  const [created] = await tx
    .insert(offerVersions)
    .values({
      workspaceId: actor.workspaceId,
      offerId,
      version,
      ...frozen,
      sha256: await sha256Hex(canonicalJson({ number, version, ...frozen })),
      sentBy: actor.userId,
    })
    .returning({ id: offerVersions.id });
  await tx
    .update(offers)
    .set({
      number,
      status: "sent",
      currentVersionId: created!.id,
      sentAt: now,
      answeredAt: null,
      declineReason: null,
    })
    .where(eq(offers.id, offerId));
  await advanceProject(tx, actor.workspaceId, offer.projectId, "offered");
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "offer.sent",
    targetType: "offer",
    targetId: offerId,
    meta: { prospectId: offer.prospectId, number, version, validUntil },
  });
  await changed(actor.workspaceId, offerId, offer.prospectId);
  return { ok: true, number, version, token: offer.publicToken };
}

/** Takes a sent offer back: the page then says it is no longer valid. */
export async function withdrawOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
): Promise<boolean> {
  const [row] = await tx
    .update(offers)
    .set({ status: "withdrawn" })
    .where(
      and(
        eq(offers.workspaceId, actor.workspaceId),
        eq(offers.id, offerId),
        inArray(offers.status, ["sent", "declined"]),
      ),
    )
    .returning({ prospectId: offers.prospectId, number: offers.number });
  if (!row) return false;
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "offer.withdrawn",
    targetType: "offer",
    targetId: offerId,
    meta: { prospectId: row.prospectId, number: row.number },
  });
  await changed(actor.workspaceId, offerId, row.prospectId);
  return true;
}

/** Deletes an offer that was never sent. */
export async function deleteOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
): Promise<{ projectId: string } | null> {
  const [row] = await tx
    .delete(offers)
    .where(
      and(
        eq(offers.workspaceId, actor.workspaceId),
        eq(offers.id, offerId),
        eq(offers.status, "draft"),
        isNull(offers.currentVersionId),
      ),
    )
    .returning({ projectId: offers.projectId });
  return row ?? null;
}

/** Copies an offer into a new draft in the same project (e.g. after a decline). */
export async function duplicateOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
): Promise<string | null> {
  const [offer] = await tx
    .select()
    .from(offers)
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
  if (!offer) return null;
  const draft = { ...offer.draft, title: `${offer.draft.title} (Kopie)`.slice(0, 160) };
  const [row] = await tx
    .insert(offers)
    .values({
      workspaceId: actor.workspaceId,
      projectId: offer.projectId,
      prospectId: offer.prospectId,
      title: draft.title,
      draft,
      publicToken: offerToken(),
      createdBy: actor.userId,
    })
    .returning({ id: offers.id });
  return row!.id;
}

/** Active catalogue entries, for the editor and the settings. */
export async function listCatalog(tx: Transaction, workspaceId: string) {
  return tx
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.workspaceId, workspaceId), isNull(catalogItems.archivedAt)))
    .orderBy(asc(catalogItems.name));
}
