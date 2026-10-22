import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import {
  auditLog,
  exposes,
  exposeVersions,
  offers,
  offerVersions,
  projects,
  prospects,
  workspaces,
} from "@/db/schema";
import type { TaxMode } from "@/domain/billing";
import type { ExposeDocument } from "@/domain/expose/schema";
import { notificationCopy, notificationUrl, OFFER_FALLBACK } from "@/domain/notifications";
import { offerAnswerSchema, type OfferAcceptance } from "@/domain/offers/acceptance";
import {
  BILLING_LABELS,
  offerDocumentSchema,
  type OfferDocument,
  type OfferStatus,
  displayStatus,
} from "@/domain/offers/schema";
import { formatCents, normaliseSelection, offerTotals } from "@/domain/offers/totals";
import { localDateString } from "@/domain/tasks";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import { defer } from "@/server/defer";
import { dispatch, notify } from "@/server/notifications/notify";
import { advanceStatus } from "@/server/prospects/auto-status";
import { advanceProject } from "@/server/projects";
import { publish, workspaceTopic } from "@/server/realtime";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import { loadWorkspaceSettings } from "@/server/workspaces";

/**
 * The public offer page `/a/<token>` (§7.10). Runs on the system connection
 * and scopes every query to the host's workspace, like the exposé (ADR-0012).
 */

export interface PublicOffer {
  id: string;
  number: string;
  status: OfferStatus | "expired";
  version: { id: string; number: number; validUntil: string; sha256: string; createdAt: Date };
  document: OfferDocument;
  taxMode: TaxMode;
  taxNote: string;
  company: string;
  projectName: string;
  acceptance: OfferAcceptance | null;
  answeredAt: Date | null;
  theme: Pick<ExposeDocument["theme"], "accent" | "appearance" | "style"> | null;
  settings: WorkspaceSettings;
  workspaceName: string;
}

export async function loadPublicOffer(
  db: Database,
  workspaceId: string,
  token: string,
  now = new Date(),
): Promise<PublicOffer | null> {
  if (!/^[0-9A-Za-z]{22}$/.test(token)) return null;
  const [row] = await db
    .select({
      offer: offers,
      version: offerVersions,
      company: prospects.companyName,
      projectName: projects.name,
      projectId: projects.id,
      workspaceName: workspaces.name,
    })
    .from(offers)
    .innerJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, offers.currentVersionId),
      ),
    )
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, offers.workspaceId), eq(prospects.id, offers.prospectId)),
    )
    .innerJoin(
      projects,
      and(eq(projects.workspaceId, offers.workspaceId), eq(projects.id, offers.projectId)),
    )
    .innerJoin(workspaces, eq(workspaces.id, offers.workspaceId))
    .where(and(eq(offers.workspaceId, workspaceId), eq(offers.publicToken, token)))
    .limit(1);
  if (!row) return null;
  const document = offerDocumentSchema.parse(row.version.document);
  const settings = await loadWorkspaceSettings(db, workspaceId);
  const [expose] = await db
    .select({ document: exposeVersions.document })
    .from(exposes)
    .innerJoin(
      exposeVersions,
      and(
        eq(exposeVersions.workspaceId, exposes.workspaceId),
        eq(exposeVersions.id, exposes.currentVersionId),
      ),
    )
    .where(and(eq(exposes.workspaceId, workspaceId), eq(exposes.projectId, row.projectId)))
    .limit(1);
  const theme = expose ? (expose.document as ExposeDocument).theme : null;
  const today = localDateString(now, settings.notifications.timezone);
  return {
    id: row.offer.id,
    number: row.offer.number ?? "",
    status: displayStatus(row.offer.status, row.version.validUntil, today),
    version: {
      id: row.version.id,
      number: row.version.version,
      validUntil: row.version.validUntil,
      sha256: row.version.sha256,
      createdAt: row.version.createdAt,
    },
    document,
    taxMode: row.version.taxMode as TaxMode,
    taxNote: row.version.taxNote,
    company: row.company,
    projectName: row.projectName,
    acceptance: row.offer.acceptance,
    answeredAt: row.offer.answeredAt,
    theme: theme
      ? { accent: theme.accent, appearance: theme.appearance, style: theme.style }
      : null,
    settings,
    workspaceName: row.workspaceName,
  };
}

/**
 * Counts a real view (no bot, not the owner's device). The first one goes
 * into the timeline and notifies the owner (§7.10); later ones only count.
 */
export async function recordOfferView(
  db: Database,
  input: { workspaceId: string; offerId: string; quiet: boolean },
  now = new Date(),
): Promise<void> {
  if (input.quiet) return;
  const [row] = await db
    .update(offers)
    .set({
      viewCount: sql`${offers.viewCount} + 1`,
      lastViewedAt: now,
      firstViewedAt: sql`coalesce(${offers.firstViewedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(
      and(
        eq(offers.workspaceId, input.workspaceId),
        eq(offers.id, input.offerId),
        eq(offers.status, "sent"),
      ),
    )
    .returning({
      viewCount: offers.viewCount,
      prospectId: offers.prospectId,
      number: offers.number,
      title: offers.title,
    });
  if (!row || row.viewCount !== 1) return;
  await db.insert(auditLog).values({
    workspaceId: input.workspaceId,
    actorUserId: null,
    action: "offer.viewed",
    targetType: "offer",
    targetId: input.offerId,
    meta: { prospectId: row.prospectId, number: row.number },
  });
  await publish([workspaceTopic(input.workspaceId)], "offer.changed", {
    offerId: input.offerId,
    prospectId: row.prospectId,
  });
  await defer(async () => {
    const company = await companyOf(db, input.workspaceId, row.prospectId);
    const pending = await notify(db, {
      workspaceId: input.workspaceId,
      trigger: "offer_viewed",
      prospectId: row.prospectId,
      groupKey: `offer_viewed:${input.offerId}`,
      url: notificationUrl({ trigger: "offer_viewed", offerId: input.offerId }),
      fallbackChannels: OFFER_FALLBACK.offer_viewed,
      ...notificationCopy({
        trigger: "offer_viewed",
        company,
        offer: [row.number, row.title].filter(Boolean).join(" · "),
      }),
    });
    if (pending) await dispatch(db, pending);
  });
}

export type AnswerResult =
  | { ok: true; status: "accepted" | "declined" }
  | { error: "invalid"; message: string }
  | { error: "not_found" | "limited" | "closed" | "outdated" };

/**
 * Accepts or declines the current version (§7.10 „Online-Annahme“). Only a
 * sent, unexpired offer can be answered, and only the version the visitor
 * saw: a newer one means reloading first. The acceptance stores who, when,
 * the version checksum and the chosen variant, options and totals.
 */
export async function answerOffer(
  db: Database,
  input: { workspaceId: string; token: string; body: unknown; internal: boolean },
  now = new Date(),
): Promise<AnswerResult> {
  const parsed = offerAnswerSchema.safeParse(input.body);
  if (!parsed.success) {
    return { error: "invalid", message: parsed.error.issues[0]?.message ?? "Ungültige Angaben." };
  }
  if (parsed.data.website)
    return { ok: true, status: parsed.data.answer === "accept" ? "accepted" : "declined" };
  const offer = await loadPublicOffer(db, input.workspaceId, input.token, now);
  if (!offer) return { error: "not_found" };
  if (!(await hitRateLimit(db, `offer:${offer.id}`, 10, 3600))) return { error: "limited" };
  if (offer.status !== "sent") return { error: "closed" };
  if (parsed.data.versionId !== offer.version.id) return { error: "outdated" };

  const answer = parsed.data;
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        prospectId: offers.prospectId,
        projectId: offers.projectId,
        status: offers.status,
        currentVersionId: offers.currentVersionId,
      })
      .from(offers)
      .where(and(eq(offers.workspaceId, input.workspaceId), eq(offers.id, offer.id)))
      .for("update");
    if (!row || row.status !== "sent") return "closed" as const;
    // A new version may have been sent since the page was loaded above.
    if (row.currentVersionId !== offer.version.id) return "outdated" as const;
    if (answer.answer === "decline") {
      await tx
        .update(offers)
        .set({ status: "declined", answeredAt: now, declineReason: answer.reason ?? null })
        .where(eq(offers.id, offer.id));
      await tx.insert(auditLog).values({
        workspaceId: input.workspaceId,
        actorUserId: null,
        action: "offer.declined",
        targetType: "offer",
        targetId: offer.id,
        meta: { prospectId: row.prospectId, number: offer.number, reason: answer.reason ?? null },
      });
      return { ...row, detail: answer.reason ? `„${answer.reason}“` : "ohne Begründung" };
    }
    const selection = normaliseSelection(offer.document, answer.selection);
    const totals = offerTotals(offer.document, selection, offer.taxMode);
    const variant = offer.document.variants.find((entry) => entry.id === selection.variantId);
    const acceptance: OfferAcceptance = {
      name: answer.name,
      role: answer.role || null,
      acceptedAt: now.toISOString(),
      versionId: offer.version.id,
      version: offer.version.number,
      sha256: offer.version.sha256,
      variantId: selection.variantId,
      variantTitle: variant?.title ?? null,
      optionalIds: selection.optionalIds,
      onceTotalCents: totals.buckets.once?.totalCents ?? 0,
      recurring: Object.entries(totals.buckets)
        .filter(([interval]) => interval !== "once")
        .map(([interval, bucket]) => ({ interval, totalCents: bucket.totalCents })),
      taxMode: offer.taxMode,
    };
    await tx
      .update(offers)
      .set({ status: "accepted", answeredAt: now, acceptance })
      .where(eq(offers.id, offer.id));
    await tx.insert(auditLog).values({
      workspaceId: input.workspaceId,
      actorUserId: null,
      action: "offer.accepted",
      targetType: "offer",
      targetId: offer.id,
      meta: {
        prospectId: row.prospectId,
        number: offer.number,
        name: answer.name,
        version: offer.version.number,
        onceTotalCents: acceptance.onceTotalCents,
      },
    });
    if (!input.internal) {
      await advanceStatus(tx, {
        workspaceId: input.workspaceId,
        prospectId: row.prospectId,
        to: "won",
        via: "offer",
        meta: { offerId: offer.id },
      });
    }
    await advanceProject(tx, input.workspaceId, row.projectId, "ordered");
    const amounts = [
      acceptance.onceTotalCents > 0 ? formatCents(acceptance.onceTotalCents) : null,
      ...acceptance.recurring.map(
        (entry) =>
          `${formatCents(entry.totalCents)} ${BILLING_LABELS[entry.interval as keyof typeof BILLING_LABELS]}`,
      ),
    ].filter(Boolean);
    return { ...row, detail: [answer.name, ...amounts].join(" · ") };
  });
  if (typeof result === "string") return { error: result };

  await publish([workspaceTopic(input.workspaceId)], "offer.changed", {
    offerId: offer.id,
    prospectId: result.prospectId,
  });
  const accepted = answer.answer === "accept";
  await defer(async () => {
    const pending = await notify(db, {
      workspaceId: input.workspaceId,
      trigger: "offer_answered",
      prospectId: result.prospectId,
      groupKey: `offer_answered:${offer.id}`,
      url: notificationUrl({ trigger: "offer_answered", offerId: offer.id }),
      fallbackChannels: OFFER_FALLBACK.offer_answered,
      ...notificationCopy({
        trigger: "offer_answered",
        company: offer.company,
        offer: [offer.number, offer.document.title].filter(Boolean).join(" · "),
        accepted,
        detail: result.detail,
      }),
    });
    if (pending) await dispatch(db, pending);
  });
  return { ok: true, status: accepted ? "accepted" : "declined" };
}

async function companyOf(db: Database, workspaceId: string, prospectId: string) {
  const [row] = await db
    .select({ company: prospects.companyName })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  return row?.company ?? "Ein Kunde";
}
