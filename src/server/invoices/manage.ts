import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, sum } from "drizzle-orm";
import type { Transaction } from "@/db";
import {
  auditLog,
  invoicePayments,
  invoices,
  offers,
  offerVersions,
  projects,
  prospects,
  workspaces,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import type { CsvInvoice } from "@/domain/invoices/csv";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import {
  billingProfileSchema,
  invoiceDocumentSchema,
  type BillingProfile,
  type InvoiceDeduction,
  type InvoiceDisplayStatus,
  type InvoiceDocument,
  type InvoiceIssuer,
  type InvoiceKind,
  type InvoiceParty,
} from "@/domain/invoices/schema";
import {
  defaultTreatment,
  issueIssues,
  needsReview,
  smallBusinessGuard,
  treatmentNote,
  type IssueIssue,
} from "@/domain/invoices/tax";
import {
  depositLines,
  germanDate,
  invoiceTotals,
  paymentState,
  servicePeriodLabel,
  type InvoiceTotals,
} from "@/domain/invoices/totals";
import { addDays, canonicalJson, seriesNumber } from "@/domain/offers/acceptance";
import { offerDocumentSchema } from "@/domain/offers/schema";
import { offerTotals, paymentPlan } from "@/domain/offers/totals";
import { localDateString } from "@/domain/tasks";
import { sha256Hex } from "@/lib/crypto";
import { nextNumber } from "@/server/offers/manage";
import { publish, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings } from "@/server/workspaces";

/** Invoices in the cockpit (§7.10, phase 7b, ADR-0070). Every function runs inside withTenant. */

type ProspectRow = typeof prospects.$inferSelect;

export function billingProfileOf(prospect: Pick<ProspectRow, "billing">): BillingProfile {
  return billingProfileSchema.parse(prospect.billing ?? {});
}

/** The owner as issuer, from the sender address and the billing settings. */
export function issuerFrom(settings: WorkspaceSettings, workspaceName: string): InvoiceIssuer {
  const sender = settings.senderAddress;
  return {
    name: sender.company ?? settings.profile.displayName ?? workspaceName,
    street: sender.street ?? null,
    postalCode: sender.postalCode ?? null,
    city: sender.city ?? null,
    country: sender.country,
    vatId: settings.billing.vatId ?? null,
    taxNumber: settings.billing.taxNumber ?? null,
    email: settings.channels.email ?? null,
    iban: settings.billing.iban ?? null,
    bic: settings.billing.bic ?? null,
    bankName: settings.billing.bankName ?? null,
  };
}

function vatIdInvalid(prospect: ProspectRow): boolean {
  const profile = billingProfileOf(prospect);
  return Boolean(
    profile.vatId && profile.vatCheck?.vatId === profile.vatId && !profile.vatCheck.valid,
  );
}

/** The customer as recipient: the billing profile, else the master data. */
export function recipientFrom(prospect: ProspectRow): InvoiceParty {
  const profile = billingProfileOf(prospect);
  const own = Boolean(profile.street || profile.city);
  return {
    name: profile.name ?? prospect.companyName,
    street: (own ? profile.street : prospect.street) ?? null,
    postalCode: (own ? profile.postalCode : prospect.postalCode) ?? null,
    city: (own ? profile.city : prospect.city) ?? null,
    country: profile.country ?? prospect.country,
    vatId: profile.vatId ?? null,
    vatCheck:
      profile.vatId && profile.vatCheck?.vatId === profile.vatId && profile.vatCheck.valid
        ? {
            checkedAt: profile.vatCheck.checkedAt,
            consultationNumber: profile.vatCheck.consultationNumber,
          }
        : null,
  };
}

function treatmentInput(settings: WorkspaceSettings, prospect: ProspectRow) {
  const profile = billingProfileOf(prospect);
  const recipient = recipientFrom(prospect);
  return {
    taxMode: settings.billing.taxMode,
    country: recipient.country,
    customerType: profile.customerType,
    vatId: recipient.vatId,
  };
}

async function changed(workspaceId: string, invoiceId: string, prospectId: string) {
  await publish([workspaceTopic(workspaceId)], "invoice.changed", { invoiceId, prospectId });
}

async function workspaceName(tx: Transaction, workspaceId: string): Promise<string> {
  const [row] = await tx
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  return row?.name ?? "";
}

export interface InvoiceListItem {
  id: string;
  number: string | null;
  kind: InvoiceKind;
  title: string;
  prospectId: string;
  company: string;
  projectId: string | null;
  projectName: string | null;
  offerId: string | null;
  issueDate: string | null;
  dueDate: string | null;
  totalCents: number;
  dueCents: number;
  paidCents: number;
  status: InvoiceDisplayStatus;
  updatedAt: Date;
}

export async function listInvoices(
  tx: Transaction,
  workspaceId: string,
  filter: { prospectId?: string; projectId?: string; offerId?: string; month?: string } = {},
  now = new Date(),
): Promise<InvoiceListItem[]> {
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const conditions = [eq(invoices.workspaceId, workspaceId)];
  if (filter.prospectId) conditions.push(eq(invoices.prospectId, filter.prospectId));
  if (filter.projectId) conditions.push(eq(invoices.projectId, filter.projectId));
  if (filter.offerId) conditions.push(eq(invoices.offerId, filter.offerId));
  if (filter.month) {
    const from = `${filter.month}-01`;
    const [year, month] = filter.month.split("-").map(Number) as [number, number];
    const to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    conditions.push(gte(invoices.issueDate, from), lt(invoices.issueDate, to));
  }
  const rows = await tx
    .select({
      invoice: invoices,
      company: prospects.companyName,
      projectName: projects.name,
      paid: sql<
        string | null
      >`(select sum(${invoicePayments.amountCents}) from ${invoicePayments} where ${invoicePayments.invoiceId} = ${invoices.id})`,
    })
    .from(invoices)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, invoices.workspaceId), eq(prospects.id, invoices.prospectId)),
    )
    .leftJoin(
      projects,
      and(eq(projects.workspaceId, invoices.workspaceId), eq(projects.id, invoices.projectId)),
    )
    .where(and(...conditions))
    .orderBy(desc(invoices.issueDate), desc(invoices.number), desc(invoices.updatedAt));
  return rows.map(({ invoice, company, projectName, paid }) => {
    const totals = invoice.totals ?? draftTotals(invoice.document, invoice.kind);
    const paidCents = Number(paid ?? 0);
    return {
      id: invoice.id,
      number: invoice.number,
      kind: invoice.kind,
      title: invoice.document.title,
      prospectId: invoice.prospectId,
      company,
      projectId: invoice.projectId,
      projectName,
      offerId: invoice.offerId,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalCents: totals.totalCents,
      dueCents: totals.dueCents,
      paidCents,
      status: paymentState(
        {
          kind: invoice.kind,
          status: invoice.status,
          dueDate: invoice.dueDate,
          dueCents: totals.dueCents,
        },
        paidCents,
        today,
      ),
      updatedAt: invoice.updatedAt,
    };
  });
}

function draftTotals(document: InvoiceDocument, kind: InvoiceKind): InvoiceTotals {
  const parsed = invoiceDocumentSchema.safeParse(document);
  return invoiceTotals(parsed.success ? parsed.data : invoiceDocumentSchema.parse({}), kind);
}

/** Issued deposit invoices of an offer that a final invoice subtracts. */
async function depositDeductions(
  tx: Transaction,
  workspaceId: string,
  offerId: string,
): Promise<InvoiceDeduction[]> {
  const rows = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      issueDate: invoices.issueDate,
      totals: invoices.totals,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.offerId, offerId),
        eq(invoices.kind, "deposit"),
        eq(invoices.status, "issued"),
      ),
    )
    .orderBy(asc(invoices.issueDate), asc(invoices.number));
  return rows.map((row) => ({
    invoiceId: row.id,
    number: row.number ?? "",
    issueDate: row.issueDate ?? "",
    byRate: row.totals?.byRate ?? [],
  }));
}

export async function loadInvoice(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
  now = new Date(),
) {
  const [row] = await tx
    .select({ invoice: invoices, prospect: prospects, projectName: projects.name })
    .from(invoices)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, invoices.workspaceId), eq(prospects.id, invoices.prospectId)),
    )
    .leftJoin(
      projects,
      and(eq(projects.workspaceId, invoices.workspaceId), eq(projects.id, invoices.projectId)),
    )
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
  if (!row) return null;
  const { invoice, prospect } = row;
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const [payments, related, offerRow] = await Promise.all([
    tx
      .select()
      .from(invoicePayments)
      .where(
        and(eq(invoicePayments.workspaceId, workspaceId), eq(invoicePayments.invoiceId, invoiceId)),
      )
      .orderBy(asc(invoicePayments.paidOn), asc(invoicePayments.createdAt)),
    tx
      .select({
        id: invoices.id,
        number: invoices.number,
        cancelsInvoiceId: invoices.cancelsInvoiceId,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, workspaceId),
          sql`(${invoices.cancelsInvoiceId} = ${invoiceId} or ${invoices.id} = ${invoice.cancelsInvoiceId ?? invoiceId})`,
          ne(invoices.id, invoiceId),
        ),
      ),
    invoice.offerId
      ? tx
          .select({ number: offers.number, title: offers.title })
          .from(offers)
          .where(and(eq(offers.workspaceId, workspaceId), eq(offers.id, invoice.offerId)))
      : Promise.resolve([]),
  ]);
  const document = invoiceDocumentSchema.parse(invoice.document);
  if (invoice.status === "draft" && invoice.kind === "final" && invoice.offerId) {
    document.deductions = await depositDeductions(tx, workspaceId, invoice.offerId);
  }
  const issuer = invoice.issuer ?? issuerFrom(settings, await workspaceName(tx, workspaceId));
  const recipient = invoice.recipient ?? recipientFrom(prospect);
  const totals = invoice.totals ?? invoiceTotals(document, invoice.kind);
  const paidCents = payments.reduce((total, payment) => total + payment.amountCents, 0);
  const input = treatmentInput(settings, prospect);
  const draft = invoice.status === "draft";
  const pendingDeposits =
    draft && invoice.kind === "final" && invoice.offerId
      ? (
          await tx
            .select({ id: invoices.id })
            .from(invoices)
            .where(
              and(
                eq(invoices.workspaceId, workspaceId),
                eq(invoices.offerId, invoice.offerId),
                eq(invoices.kind, "deposit"),
                eq(invoices.status, "draft"),
              ),
            )
        ).length
      : 0;
  const smallBusinessRevenueCents =
    draft && document.treatment === "small_business"
      ? (await smallBusinessRevenue(tx, workspaceId, Number(today.slice(0, 4)))).revenueCents
      : undefined;
  const issues = draft
    ? issueIssues({
        kind: invoice.kind,
        treatment: document.treatment,
        totals,
        hasLines: document.lines.length > 0,
        hasServicePeriod: Boolean(document.servicePeriod),
        issuer,
        recipient,
        customerType: input.customerType,
        review: needsReview(input),
        pendingDeposits,
        smallBusinessRevenueCents,
        vatIdInvalid: vatIdInvalid(prospect),
      })
    : [];
  return {
    invoice,
    document,
    prospect,
    projectName: row.projectName,
    offer: offerRow[0] ?? null,
    issuer,
    recipient,
    totals,
    taxNote:
      invoice.taxNote ??
      treatmentNote(document.treatment, settings.billing.smallBusinessNote, document.taxNote),
    payments,
    paidCents,
    status: paymentState(
      {
        kind: invoice.kind,
        status: invoice.status,
        dueDate: invoice.dueDate,
        dueCents: totals.dueCents,
      },
      paidCents,
      today,
    ),
    cancelledBy: related.find((entry) => entry.cancelsInvoiceId === invoiceId) ?? null,
    cancels: related.find((entry) => entry.id === invoice.cancelsInvoiceId) ?? null,
    issues,
    defaultTreatment: defaultTreatment(input),
    settings,
    today,
  };
}

function emptyDocument(
  settings: WorkspaceSettings,
  prospect: ProspectRow,
  patch: Partial<InvoiceDocument> = {},
): InvoiceDocument {
  const profile = billingProfileOf(prospect);
  return invoiceDocumentSchema.parse({
    title: "Rechnung",
    intro: settings.billing.invoiceIntro,
    outro: settings.billing.invoiceOutro,
    paymentTermsDays: profile.paymentTermsDays ?? settings.billing.paymentTermsDays,
    treatment: defaultTreatment(treatmentInput(settings, prospect)),
    ...patch,
  });
}

async function loadProspect(tx: Transaction, workspaceId: string, prospectId: string) {
  const [prospect] = await tx
    .select()
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  return prospect ?? null;
}

/** An empty draft for a customer, optionally in a project. */
export async function createInvoice(
  tx: Transaction,
  actor: Actor,
  input: { prospectId: string; projectId?: string | null },
  now = new Date(),
): Promise<string | null> {
  const prospect = await loadProspect(tx, actor.workspaceId, input.prospectId);
  // A restricted customer (Sperrvermerk) only keeps what is already issued.
  if (!prospect || prospect.restrictedAt) return null;
  if (input.projectId) {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.workspaceId, actor.workspaceId),
          eq(projects.id, input.projectId),
          eq(projects.prospectId, prospect.id),
        ),
      );
    if (!project) return null;
  }
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const [created] = await tx
    .insert(invoices)
    .values({
      workspaceId: actor.workspaceId,
      prospectId: prospect.id,
      projectId: input.projectId ?? null,
      document: emptyDocument(settings, prospect, { servicePeriod: { from: today } }),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await changed(actor.workspaceId, created!.id, prospect.id);
  return created!.id;
}

/**
 * Drafts for the instalments of an accepted offer that have no invoice yet
 * (§7.10): every instalment but the last becomes a deposit invoice, the last
 * the final invoice over all one-off lines minus the deposits. A plan with
 * one instalment gives one ordinary invoice. Recurring lines are billed by
 * the maintenance contract (7c).
 */
export async function createInvoicesFromOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
  now = new Date(),
): Promise<{ created: number } | { error: "not_found" | "not_accepted" | "nothing_left" }> {
  const [row] = await tx
    .select({ offer: offers, document: offerVersions.document, version: offerVersions.version })
    .from(offers)
    .innerJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, sql`(${offers.acceptance} ->> 'versionId')::uuid`),
      ),
    )
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)))
    .for("update", { of: offers });
  if (!row) {
    const [exists] = await tx
      .select({ status: offers.status })
      .from(offers)
      .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
    return { error: exists ? "not_accepted" : "not_found" };
  }
  const { offer } = row;
  if (offer.status !== "accepted" || !offer.acceptance) return { error: "not_accepted" };
  const prospect = await loadProspect(tx, actor.workspaceId, offer.prospectId);
  if (!prospect) return { error: "not_found" };
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const document = offerDocumentSchema.parse(row.document);
  const selection = {
    variantId: offer.acceptance.variantId,
    optionalIds: offer.acceptance.optionalIds,
  };
  const totals = offerTotals(document, selection, settings.billing.taxMode);
  const once = totals.buckets.once;
  if (!once) return { error: "nothing_left" };
  const plan = paymentPlan(document.paymentPlan, once.totalCents);
  const existing = await tx
    .select({ milestoneId: invoices.milestoneId })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, actor.workspaceId),
        eq(invoices.offerId, offerId),
        ne(invoices.kind, "cancellation"),
        ne(invoices.status, "cancelled"),
      ),
    );
  const billed = new Set(existing.map((entry) => entry.milestoneId));
  const bases = once.vat.length
    ? once.vat.map((entry) => ({ rate: entry.rate, baseCents: entry.baseCents }))
    : byRateFromLines(
        totals.lines.filter((line) => line.billing === "once"),
        document.discountPercent,
      );
  const reference = `Angebot ${offer.number ?? ""}`.trim();
  let created = 0;
  for (const [index, instalment] of plan.instalments.entries()) {
    if (billed.has(instalment.id)) continue;
    const last = index === plan.instalments.length - 1;
    const kind: InvoiceKind = !last
      ? "deposit"
      : plan.instalments.length > 1
        ? "final"
        : "standard";
    const lines =
      kind === "deposit"
        ? depositLines(
            bases,
            once.totalCents,
            instalment.amountCents,
            `${instalment.title} (${instalment.shareLabel}) gemäß ${reference}`,
          )
        : totals.lines
            .filter((line) => line.billing === "once")
            .map((line) => ({
              id: line.id,
              title: line.title,
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceCents: line.unitPriceCents,
              discountPercent:
                document.items.find((item) => item.id === line.id)?.discountPercent ?? 0,
              vatRate: line.vatRate,
            }));
    const title =
      kind === "deposit"
        ? `Anzahlung: ${offer.title}`
        : kind === "final"
          ? `Schlussrechnung: ${offer.title}`
          : offer.title;
    const [invoice] = await tx
      .insert(invoices)
      .values({
        workspaceId: actor.workspaceId,
        prospectId: offer.prospectId,
        projectId: offer.projectId,
        offerId,
        milestoneId: instalment.id,
        kind,
        document: emptyDocument(settings, prospect, {
          title,
          lines,
          discountPercent: kind === "deposit" ? 0 : document.discountPercent,
          servicePeriod: { from: instalment.date ?? today },
        }),
        createdBy: actor.userId,
      })
      .returning({ id: invoices.id });
    await changed(actor.workspaceId, invoice!.id, offer.prospectId);
    created++;
  }
  return created > 0 ? { created } : { error: "nothing_left" };
}

function byRateFromLines(
  lines: { vatRate: 20 | 13 | 10 | 0; netCents: number }[],
  discount: number,
) {
  const map = new Map<20 | 13 | 10 | 0, number>();
  for (const line of lines) map.set(line.vatRate, (map.get(line.vatRate) ?? 0) + line.netCents);
  return [...map.entries()]
    .sort(([a], [b]) => b - a)
    .map(([rate, cents]) => ({ rate, baseCents: cents - Math.round((cents * discount) / 100) }));
}

export type SaveResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "locked" | "invalid";
      issues?: { path: string; message: string }[];
    };

export async function saveInvoiceDraft(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
  input: unknown,
): Promise<SaveResult> {
  const parsed = invoiceDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const [row] = await tx
    .select({ status: invoices.status, prospectId: invoices.prospectId })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.id, invoiceId)))
    .for("update");
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "draft") return { ok: false, error: "locked" };
  await tx
    .update(invoices)
    .set({ document: { ...parsed.data, deductions: [] } })
    .where(eq(invoices.id, invoiceId));
  await changed(actor.workspaceId, invoiceId, row.prospectId);
  return { ok: true };
}

export type IssueResult =
  | { ok: true; number: string }
  | { ok: false; error: "not_found" | "locked" | "invalid"; issues?: IssueIssue[] };

function frozenHash(value: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

/**
 * Issues a draft (§ 11 UStG): checks the mandatory contents, assigns the
 * next number of the year, sets issue and due date and freezes everything.
 */
export async function issueInvoice(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
  now = new Date(),
): Promise<IssueResult> {
  const [locked] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.id, invoiceId)))
    .for("update");
  if (!locked) return { ok: false, error: "not_found" };
  const loaded = await loadInvoice(tx, actor.workspaceId, invoiceId, now);
  if (!loaded) return { ok: false, error: "not_found" };
  if (loaded.invoice.status !== "draft") return { ok: false, error: "locked" };
  const errors = loaded.issues.filter((issue) => issue.level === "error");
  if (errors.length > 0) return { ok: false, error: "invalid", issues: errors };

  const issueDate = loaded.today;
  const year = Number(issueDate.slice(0, 4));
  const number = seriesNumber("RE", year, await nextNumber(tx, actor.workspaceId, "invoice", year));
  const dueDate = addDays(issueDate, loaded.document.paymentTermsDays);
  const frozen = {
    number,
    kind: loaded.invoice.kind,
    issueDate,
    dueDate,
    document: loaded.document,
    totals: loaded.totals,
    issuer: loaded.issuer,
    recipient: loaded.recipient,
    taxNote: loaded.taxNote,
  };
  await tx
    .update(invoices)
    .set({
      status: "issued",
      number,
      issueDate,
      dueDate,
      document: loaded.document,
      totals: loaded.totals,
      issuer: loaded.issuer,
      recipient: loaded.recipient,
      taxNote: loaded.taxNote,
      sha256: await frozenHash(frozen),
      issuedAt: now,
      issuedBy: actor.userId,
    })
    .where(eq(invoices.id, invoiceId));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "invoice.issued",
    targetType: "invoice",
    targetId: invoiceId,
    meta: {
      prospectId: loaded.invoice.prospectId,
      number,
      kind: loaded.invoice.kind,
      totalCents: loaded.totals.totalCents,
    },
  });
  await changed(actor.workspaceId, invoiceId, loaded.invoice.prospectId);
  return { ok: true, number };
}

/**
 * Cancels an issued invoice: a cancellation invoice with its own number
 * negates every line and refers to the original, which moves to „cancelled“.
 * A new, correct invoice is then a fresh draft.
 */
export async function cancelInvoice(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
  now = new Date(),
): Promise<
  | { ok: true; number: string; id: string }
  | { ok: false; error: "not_found" | "locked" | "deducted"; by?: string }
> {
  const [original] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.id, invoiceId)))
    .for("update");
  if (!original) return { ok: false, error: "not_found" };
  if (original.status !== "issued" || original.kind === "cancellation") {
    return { ok: false, error: "locked" };
  }
  if (original.kind === "deposit" && original.offerId) {
    // An issued final invoice already subtracts this deposit; cancel that one first.
    const [final] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, actor.workspaceId),
          eq(invoices.offerId, original.offerId),
          eq(invoices.kind, "final"),
          eq(invoices.status, "issued"),
          sql`${invoices.document} -> 'deductions' @> ${JSON.stringify([{ invoiceId: original.id }])}::jsonb`,
        ),
      )
      .limit(1);
    if (final) return { ok: false, error: "deducted", by: final.number ?? undefined };
  }
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const issueDate = localDateString(now, settings.notifications.timezone);
  const year = Number(issueDate.slice(0, 4));
  const number = seriesNumber("RE", year, await nextNumber(tx, actor.workspaceId, "invoice", year));
  const document: InvoiceDocument = {
    ...invoiceDocumentSchema.parse(original.document),
    title: `Storno zu ${original.number}`,
    intro: `Die Rechnung ${original.number} vom ${germanDate(original.issueDate!)} wird hiermit storniert.`,
    outro: undefined,
    paymentTermsDays: 0,
  };
  const totals = invoiceTotals(document, "cancellation");
  const frozen = {
    number,
    kind: "cancellation",
    issueDate,
    dueDate: issueDate,
    document,
    totals,
    issuer: original.issuer,
    recipient: original.recipient,
    taxNote: original.taxNote,
    cancels: original.number,
  };
  const [created] = await tx
    .insert(invoices)
    .values({
      workspaceId: actor.workspaceId,
      prospectId: original.prospectId,
      projectId: original.projectId,
      offerId: original.offerId,
      milestoneId: original.milestoneId,
      kind: "cancellation",
      status: "issued",
      number,
      issueDate,
      dueDate: issueDate,
      document,
      totals,
      issuer: original.issuer,
      recipient: original.recipient,
      taxNote: original.taxNote,
      sha256: await frozenHash(frozen),
      cancelsInvoiceId: original.id,
      issuedAt: now,
      issuedBy: actor.userId,
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await tx.update(invoices).set({ status: "cancelled" }).where(eq(invoices.id, original.id));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "invoice.cancelled",
    targetType: "invoice",
    targetId: original.id,
    meta: { prospectId: original.prospectId, number: original.number, cancellation: number },
  });
  await changed(actor.workspaceId, original.id, original.prospectId);
  return { ok: true, number, id: created!.id };
}

export async function deleteInvoiceDraft(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
): Promise<{ prospectId: string; projectId: string | null } | null> {
  const [row] = await tx
    .delete(invoices)
    .where(
      and(
        eq(invoices.workspaceId, actor.workspaceId),
        eq(invoices.id, invoiceId),
        eq(invoices.status, "draft"),
      ),
    )
    .returning({ prospectId: invoices.prospectId, projectId: invoices.projectId });
  if (!row) return null;
  await changed(actor.workspaceId, invoiceId, row.prospectId);
  return row;
}

export async function addPayment(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
  input: { amountCents: number; paidOn: string; note?: string },
): Promise<"ok" | "not_found" | "locked"> {
  const [invoice] = await tx
    .select({
      status: invoices.status,
      kind: invoices.kind,
      prospectId: invoices.prospectId,
      number: invoices.number,
    })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.id, invoiceId)));
  if (!invoice) return "not_found";
  if (invoice.status !== "issued" || invoice.kind === "cancellation") return "locked";
  await tx.insert(invoicePayments).values({
    workspaceId: actor.workspaceId,
    invoiceId,
    amountCents: input.amountCents,
    paidOn: input.paidOn,
    note: input.note || null,
    createdBy: actor.userId,
  });
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "invoice.paid",
    targetType: "invoice",
    targetId: invoiceId,
    meta: {
      prospectId: invoice.prospectId,
      number: invoice.number,
      amountCents: input.amountCents,
      paidOn: input.paidOn,
    },
  });
  await changed(actor.workspaceId, invoiceId, invoice.prospectId);
  return "ok";
}

export async function deletePayment(
  tx: Transaction,
  actor: Actor,
  paymentId: string,
): Promise<string | null> {
  const [row] = await tx
    .delete(invoicePayments)
    .where(
      and(eq(invoicePayments.workspaceId, actor.workspaceId), eq(invoicePayments.id, paymentId)),
    )
    .returning({ invoiceId: invoicePayments.invoiceId });
  if (!row) return null;
  const [invoice] = await tx
    .select({ prospectId: invoices.prospectId })
    .from(invoices)
    .where(eq(invoices.id, row.invoiceId));
  if (invoice) await changed(actor.workspaceId, row.invoiceId, invoice.prospectId);
  return row.invoiceId;
}

/**
 * Gross turnover of the calendar year under the small-business exemption,
 * cancellations subtracted, for the limit guard (§ 6 Abs. 1 Z 27 UStG).
 */
export async function smallBusinessRevenue(
  tx: Transaction,
  workspaceId: string,
  year: number,
): Promise<{ revenueCents: number; guard: ReturnType<typeof smallBusinessGuard> }> {
  const [row] = await tx
    .select({
      // What was billed: a final invoice's total minus the deposits counted on their own.
      total: sum(
        sql<number>`(${invoices.totals} ->> 'totalCents')::bigint - coalesce((${invoices.totals} ->> 'deductedCents')::bigint, 0)`,
      ),
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        inArray(invoices.status, ["issued", "cancelled"]),
        gte(invoices.issueDate, `${year}-01-01`),
        lt(invoices.issueDate, `${year + 1}-01-01`),
        sql`${invoices.document} ->> 'treatment' = 'small_business'`,
      ),
    );
  const revenueCents = Number(row?.total ?? 0);
  return { revenueCents, guard: smallBusinessGuard(revenueCents) };
}

/** Whether a customer has issued invoices, which must be kept (§ 132 BAO). */
export async function hasIssuedInvoices(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.prospectId, prospectId),
        ne(invoices.status, "draft"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Saves the billing profile of a customer. */
/** The stored billing profile of a customer, null when there is none. */
export async function billingProfileFor(
  tx: Transaction,
  workspaceId: string,
  prospectId: string,
): Promise<BillingProfile | null> {
  const [row] = await tx
    .select({ billing: prospects.billing })
    .from(prospects)
    .where(and(eq(prospects.workspaceId, workspaceId), eq(prospects.id, prospectId)));
  return row ? billingProfileOf(row) : null;
}

export async function saveBillingProfile(
  tx: Transaction,
  actor: Actor,
  prospectId: string,
  profile: BillingProfile,
): Promise<boolean> {
  const [row] = await tx
    .update(prospects)
    .set({ billing: profile })
    .where(
      and(
        eq(prospects.workspaceId, actor.workspaceId),
        eq(prospects.id, prospectId),
        isNull(prospects.restrictedAt),
      ),
    )
    .returning({ id: prospects.id });
  return Boolean(row);
}

/** Issued invoices of a month for the tax adviser's CSV (§7.10). */
export async function monthCsvRows(
  tx: Transaction,
  workspaceId: string,
  month: string,
  now = new Date(),
): Promise<CsvInvoice[]> {
  const list = await listInvoices(tx, workspaceId, { month }, now);
  // In number order, as the tax adviser books them.
  const issued = list
    .filter((row) => row.number)
    .sort((a, b) => a.number!.localeCompare(b.number!));
  if (issued.length === 0) return [];
  const rows = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        inArray(
          invoices.id,
          issued.map((row) => row.id),
        ),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const numbers = new Map(rows.map((row) => [row.id, row.number]));
  return issued.map((item) => {
    const row = byId.get(item.id)!;
    const totals = row.totals!;
    return {
      number: row.number!,
      kind: row.kind,
      issueDate: row.issueDate!,
      servicePeriod: servicePeriodLabel(row.document.servicePeriod),
      customer: row.recipient?.name ?? item.company,
      customerVatId: row.recipient?.vatId ?? null,
      country: row.recipient?.country ?? "",
      treatment: row.document.treatment,
      netCents: totals.netCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      deductedCents: totals.deductedCents,
      dueCents: totals.dueCents,
      paidCents: item.paidCents,
      status: item.status,
      cancels: row.cancelsInvoiceId ? (numbers.get(row.cancelsInvoiceId) ?? null) : null,
    };
  });
}

/** Whether the workspace has issued reverse-charge invoices, which need a ZM. */
export async function hasReverseCharge(tx: Transaction, workspaceId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        ne(invoices.status, "draft"),
        sql`${invoices.document} ->> 'treatment' = 'reverse_charge'`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
