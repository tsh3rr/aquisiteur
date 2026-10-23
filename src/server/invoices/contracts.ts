import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { withTenant, type Database, type Transaction } from "@/db";
import {
  auditLog,
  invoices,
  maintenanceContracts,
  offers,
  offerVersions,
  projects,
  prospects,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { INVOICE_SEND_MODES, type InvoiceSendMode } from "@/domain/invoices/email";
import {
  CONTRACT_INTERVALS,
  billingDate,
  contractState,
  duePeriods,
  earliestEnd,
  nextPeriod,
  periodLines,
  sameLines,
  type ContractInterval,
  type ContractPeriod,
  type ContractState,
  type ContractTerms,
} from "@/domain/invoices/maintenance";
import { invoiceDocumentSchema, type InvoiceLine } from "@/domain/invoices/schema";
import { invoiceTotals } from "@/domain/invoices/totals";
import { BILLING_LABELS, offerDocumentSchema } from "@/domain/offers/schema";
import { offerTotals } from "@/domain/offers/totals";
import { addDays, localDateString } from "@/domain/tasks";
import { serverEnv } from "@/config/env";
import { loadWorkspaceSettings, workspaceOwner } from "@/server/workspaces";
import { changed, emptyDocument, issueInvoice, loadProspect } from "./manage";
import { renderInvoicePdfOnServer } from "./pdf";
import { loadInvoiceDelivery, requestInvoiceApproval, sendInvoiceEmail } from "./send";

/**
 * Maintenance contracts (§7.10, phase 7c-3, ADR-0073). Created from the
 * recurring lines of an accepted offer, one per interval; the hourly job
 * bills each due period as a draft and, by the send mode, leaves it, asks
 * for approval with a task, or issues and sends it by itself.
 */

type ContractRow = typeof maintenanceContracts.$inferSelect;

function termsOf(contract: ContractRow): ContractTerms {
  return {
    interval: contract.interval as ContractInterval,
    timing: contract.timing,
    startDate: contract.startDate,
    endDate: contract.endDate,
    billedUntil: contract.billedUntil,
  };
}

/**
 * One contract per recurring interval of the accepted selection. The start
 * follows the offer's terms: the acceptance day, a fixed date, or open until
 * the owner enters the go-live. Running it again creates nothing twice.
 */
export async function createContractsFromOffer(
  tx: Transaction,
  actor: Actor,
  offerId: string,
): Promise<{ created: number } | { error: "not_found" | "not_accepted" | "nothing_left" }> {
  const [row] = await tx
    .select({ offer: offers, document: offerVersions.document })
    .from(offers)
    .innerJoin(
      offerVersions,
      and(
        eq(offerVersions.workspaceId, offers.workspaceId),
        eq(offerVersions.id, sql`(${offers.acceptance} ->> 'versionId')::uuid`),
      ),
    )
    .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
  if (!row) {
    const [exists] = await tx
      .select({ id: offers.id })
      .from(offers)
      .where(and(eq(offers.workspaceId, actor.workspaceId), eq(offers.id, offerId)));
    return { error: exists ? "not_accepted" : "not_found" };
  }
  const { offer } = row;
  if (offer.status !== "accepted" || !offer.acceptance) return { error: "not_accepted" };
  const prospect = await loadProspect(tx, actor.workspaceId, offer.prospectId);
  if (!prospect || prospect.restrictedAt) return { error: "not_found" };
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const document = offerDocumentSchema.parse(row.document);
  const totals = offerTotals(
    document,
    { variantId: offer.acceptance.variantId, optionalIds: offer.acceptance.optionalIds },
    settings.billing.taxMode,
  );
  const terms = document.maintenance;
  const startDate =
    terms.startOn === "acceptance"
      ? localDateString(new Date(offer.acceptance.acceptedAt), settings.notifications.timezone)
      : terms.startOn === "date"
        ? (terms.startDate ?? null)
        : null;
  const intervals = CONTRACT_INTERVALS.filter((interval) => totals.buckets[interval]);
  let created = 0;
  for (const interval of intervals) {
    const lines: InvoiceLine[] = totals.lines
      .filter((line) => line.billing === interval)
      .map((line) => ({
        id: line.id,
        title: line.title,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unitPriceCents: line.unitPriceCents,
        discountPercent: document.items.find((item) => item.id === line.id)?.discountPercent ?? 0,
        vatRate: line.vatRate,
      }));
    const title =
      intervals.length > 1
        ? `Wartung ${BILLING_LABELS[interval]}: ${offer.title}`
        : `Wartung: ${offer.title}`;
    const [inserted] = await tx
      .insert(maintenanceContracts)
      .values({
        workspaceId: actor.workspaceId,
        prospectId: offer.prospectId,
        projectId: offer.projectId,
        offerId,
        title,
        interval,
        timing: terms.timing,
        lines,
        startDate,
        minimumMonths: terms.minimumMonths,
        noticeMonths: terms.noticeMonths,
        createdBy: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: maintenanceContracts.id });
    if (!inserted) continue;
    created++;
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "contract.created",
      targetType: "prospect",
      targetId: offer.prospectId,
      meta: { contractId: inserted.id, offerId, interval },
    });
  }
  return created > 0 ? { created } : { error: "nothing_left" };
}

export interface ContractListItem {
  id: string;
  title: string;
  prospectId: string;
  companyName: string;
  projectName: string | null;
  interval: ContractInterval;
  periodNetCents: number;
  state: ContractState;
  startDate: string | null;
  endDate: string | null;
  /** When the next invoice is drafted, or null when nothing is left to bill. */
  nextBilling: string | null;
}

function periodNet(lines: InvoiceLine[]): number {
  return invoiceTotals(invoiceDocumentSchema.parse({ lines })).netCents;
}

export async function listContracts(
  tx: Transaction,
  workspaceId: string,
  filter: { prospectId?: string; offerId?: string } = {},
  now = new Date(),
): Promise<ContractListItem[]> {
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const rows = await tx
    .select({
      contract: maintenanceContracts,
      companyName: prospects.companyName,
      restrictedAt: prospects.restrictedAt,
      projectName: projects.name,
    })
    .from(maintenanceContracts)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, maintenanceContracts.workspaceId),
        eq(prospects.id, maintenanceContracts.prospectId),
      ),
    )
    .leftJoin(
      projects,
      and(
        eq(projects.workspaceId, maintenanceContracts.workspaceId),
        eq(projects.id, maintenanceContracts.projectId),
      ),
    )
    .where(
      and(
        eq(maintenanceContracts.workspaceId, workspaceId),
        filter.prospectId ? eq(maintenanceContracts.prospectId, filter.prospectId) : undefined,
        filter.offerId ? eq(maintenanceContracts.offerId, filter.offerId) : undefined,
      ),
    )
    .orderBy(asc(prospects.companyName), asc(maintenanceContracts.createdAt));
  return rows.map(({ contract, companyName, restrictedAt, projectName }) => {
    const terms = termsOf(contract);
    // A customer with a Sperrvermerk is never billed again (the job skips them).
    const next = restrictedAt ? null : nextPeriod(terms);
    return {
      id: contract.id,
      title: contract.title,
      prospectId: contract.prospectId,
      companyName,
      projectName,
      interval: terms.interval,
      periodNetCents: periodNet(contract.lines),
      state: restrictedAt ? "ended" : contractState(terms, today),
      startDate: contract.startDate,
      endDate: contract.endDate,
      nextBilling: next ? billingDate(next, terms.timing) : null,
    };
  });
}

export async function loadContract(
  tx: Transaction,
  workspaceId: string,
  contractId: string,
  now = new Date(),
) {
  const [row] = await tx
    .select({
      contract: maintenanceContracts,
      prospect: prospects,
      projectName: projects.name,
      offerNumber: offers.number,
    })
    .from(maintenanceContracts)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, maintenanceContracts.workspaceId),
        eq(prospects.id, maintenanceContracts.prospectId),
      ),
    )
    .leftJoin(
      projects,
      and(
        eq(projects.workspaceId, maintenanceContracts.workspaceId),
        eq(projects.id, maintenanceContracts.projectId),
      ),
    )
    .leftJoin(
      offers,
      and(
        eq(offers.workspaceId, maintenanceContracts.workspaceId),
        eq(offers.id, maintenanceContracts.offerId),
      ),
    )
    .where(
      and(
        eq(maintenanceContracts.workspaceId, workspaceId),
        eq(maintenanceContracts.id, contractId),
      ),
    );
  if (!row) return null;
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const terms = termsOf(row.contract);
  const next = nextPeriod(terms);
  return {
    ...row,
    terms,
    today,
    state: contractState(terms, today),
    periodNetCents: periodNet(row.contract.lines),
    next: next ? { ...next, billingDate: billingDate(next, terms.timing) } : null,
    workspaceSendMode: settings.billing.invoiceSendMode,
  };
}

export type ContractResult =
  { ok: true } | { ok: false; error: "not_found" | "locked" | "invalid"; message?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function lockContract(tx: Transaction, workspaceId: string, contractId: string) {
  const [contract] = await tx
    .select()
    .from(maintenanceContracts)
    .where(
      and(
        eq(maintenanceContracts.workspaceId, workspaceId),
        eq(maintenanceContracts.id, contractId),
      ),
    )
    .for("update");
  return contract ?? null;
}

const RESTRICTED = {
  ok: false,
  error: "locked",
  message: "Für diesen Kunden gilt ein Sperrvermerk.",
} as const;

async function isRestricted(tx: Transaction, workspaceId: string, prospectId: string) {
  return Boolean((await loadProspect(tx, workspaceId, prospectId))?.restrictedAt);
}

/** Start date (only before the first invoice) and send mode. */
export async function saveContract(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  input: { startDate: string | null; sendMode: InvoiceSendMode | null },
): Promise<ContractResult> {
  if (input.startDate !== null && !ISO_DATE.test(input.startDate)) {
    return { ok: false, error: "invalid", message: "Bitte ein gültiges Datum angeben." };
  }
  if (input.sendMode !== null && !INVOICE_SEND_MODES.includes(input.sendMode)) {
    return { ok: false, error: "invalid", message: "Unbekannte Versandart." };
  }
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  if (await isRestricted(tx, actor.workspaceId, contract.prospectId)) return RESTRICTED;
  const startChanged = input.startDate !== contract.startDate;
  if (startChanged && contract.billedUntil) {
    return {
      ok: false,
      error: "locked",
      message: "Der Beginn steht fest, sobald die erste Rechnung angelegt ist.",
    };
  }
  if (input.startDate && contract.endDate && input.startDate > contract.endDate) {
    return { ok: false, error: "invalid", message: "Der Beginn liegt nach dem Vertragsende." };
  }
  await tx
    .update(maintenanceContracts)
    .set({ startDate: input.startDate, sendMode: input.sendMode })
    .where(eq(maintenanceContracts.id, contractId));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: "contract.updated",
    targetType: "prospect",
    targetId: contract.prospectId,
    meta: { contractId, startDate: input.startDate, sendMode: input.sendMode },
  });
  return { ok: true };
}

/**
 * Records a notice („Kündigung“): the end defaults to the earliest the terms
 * allow and may be later; it can never lie inside a period already billed.
 * Null for both withdraws the notice.
 */
export async function setContractEnd(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  input: { noticeReceivedOn: string | null; endDate: string | null },
): Promise<ContractResult & { endDate?: string | null }> {
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return { ok: false, error: "not_found" };
  if (await isRestricted(tx, actor.workspaceId, contract.prospectId)) return RESTRICTED;
  let endDate: string | null = null;
  if (input.noticeReceivedOn !== null) {
    if (
      !ISO_DATE.test(input.noticeReceivedOn) ||
      (input.endDate && !ISO_DATE.test(input.endDate))
    ) {
      return { ok: false, error: "invalid", message: "Bitte ein gültiges Datum angeben." };
    }
    const earliest = earliestEnd(contract, input.noticeReceivedOn);
    endDate = input.endDate ?? earliest;
    if (contract.billedUntil && endDate < contract.billedUntil) {
      return {
        ok: false,
        error: "invalid",
        message: `Bis ${contract.billedUntil} ist schon abgerechnet; das Ende kann nicht davor liegen.`,
      };
    }
    if (contract.startDate && endDate < contract.startDate) {
      return { ok: false, error: "invalid", message: "Das Ende liegt vor dem Beginn." };
    }
  }
  await tx
    .update(maintenanceContracts)
    .set({ noticeReceivedOn: input.noticeReceivedOn, endDate })
    .where(eq(maintenanceContracts.id, contractId));
  await tx.insert(auditLog).values({
    workspaceId: actor.workspaceId,
    actorUserId: actor.userId,
    action: endDate ? "contract.notice" : "contract.notice_withdrawn",
    targetType: "prospect",
    targetId: contract.prospectId,
    meta: { contractId, noticeReceivedOn: input.noticeReceivedOn, endDate },
  });
  return { ok: true, endDate };
}

/** Drafts the invoice for one period and moves the contract on; null if another run did. */
async function billPeriod(
  tx: Transaction,
  actor: Actor,
  contractId: string,
  period: ContractPeriod,
): Promise<string | null> {
  const contract = await lockContract(tx, actor.workspaceId, contractId);
  if (!contract) return null;
  const expected = nextPeriod(termsOf(contract));
  if (!expected || expected.from !== period.from || expected.to !== period.to) return null;
  const prospect = await loadProspect(tx, actor.workspaceId, contract.prospectId);
  if (!prospect || prospect.restrictedAt) return null;
  const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
  const [invoice] = await tx
    .insert(invoices)
    .values({
      workspaceId: actor.workspaceId,
      prospectId: contract.prospectId,
      projectId: contract.projectId,
      offerId: contract.offerId,
      contractId,
      contractPeriodFrom: period.from,
      document: emptyDocument(settings, prospect, {
        title: contract.title,
        lines: periodLines(contract.lines, period),
        servicePeriod: { from: period.from, to: period.to },
      }),
      createdBy: actor.userId,
    })
    .returning({ id: invoices.id });
  await tx
    .update(maintenanceContracts)
    .set({ billedUntil: period.to })
    .where(eq(maintenanceContracts.id, contractId));
  await changed(actor.workspaceId, invoice!.id, contract.prospectId);
  return invoice!.id;
}

type AutoResult = { ok: true } | { ok: false; reason: string };

/**
 * „Automatisch“ (§7.10): only a full period whose lines equal the contract's
 * last issued invoice is issued and sent without a look. Everything else,
 * and every failure on the way, falls back to an approval task with the reason.
 */
async function sendAutomatically(
  db: Database,
  actor: Actor,
  invoiceId: string,
  contractId: string,
  period: ContractPeriod,
  now: Date,
): Promise<AutoResult> {
  if (!period.full) return { ok: false, reason: "Anteiliger Zeitraum, bitte prüfen." };
  if (serverEnv().HOSTING_PROFILE !== "node") {
    return { ok: false, reason: "Auf diesem Hosting kann der Server kein PDF erstellen." };
  }
  const tenant = <T>(fn: (tx: Transaction) => Promise<T>) =>
    withTenant(db, { userId: actor.userId, workspaceId: actor.workspaceId }, fn);
  const prepared = await tenant(async (tx): Promise<AutoResult & { pdf?: Uint8Array }> => {
    const [draft] = await tx
      .select({ document: invoices.document })
      .from(invoices)
      .where(and(eq(invoices.workspaceId, actor.workspaceId), eq(invoices.id, invoiceId)));
    const [previous] = await tx
      .select({ document: invoices.document })
      .from(invoices)
      .where(
        and(
          eq(invoices.workspaceId, actor.workspaceId),
          eq(invoices.contractId, contractId),
          eq(invoices.status, "issued"),
          ne(invoices.kind, "cancellation"),
          ne(invoices.id, invoiceId),
        ),
      )
      .orderBy(desc(invoices.contractPeriodFrom))
      .limit(1);
    if (!draft) return { ok: false, reason: "Rechnung nicht gefunden." };
    if (!previous)
      return { ok: false, reason: "Erste Rechnung des Vertrags, bitte einmal prüfen." };
    if (!sameLines(previous.document.lines, draft.document.lines)) {
      return { ok: false, reason: "Die Positionen weichen von der letzten Rechnung ab." };
    }
    const issued = await issueInvoice(tx, actor, invoiceId, now);
    if (!issued.ok) {
      const first = issued.issues?.[0]?.message;
      return { ok: false, reason: first ? `Nicht ausstellbar: ${first}` : "Nicht ausstellbar." };
    }
    return { ok: true };
  });
  if (!prepared.ok) return prepared;
  // Issued from here on: a failure leaves a task to send it by hand.
  const ready = await tenant(async (tx) => {
    const delivery = await loadInvoiceDelivery(tx, actor.workspaceId, invoiceId);
    if (!delivery?.draft.to)
      return { ok: false as const, reason: "Keine E-Mail-Adresse beim Kunden." };
    const pdf = await renderInvoicePdfOnServer(tx, actor.workspaceId, invoiceId);
    if (!pdf.ok) {
      return {
        ok: false as const,
        reason:
          pdf.reason === "logo"
            ? "Das Logo bitte unter Einstellungen → Marke neu hochladen, damit der Server es drucken kann."
            : "Das PDF konnte auf dem Server nicht erstellt werden.",
      };
    }
    return { ok: true as const, draft: delivery.draft, pdf: pdf.bytes };
  });
  if (!ready.ok) return ready;
  const sent = await sendInvoiceEmail(
    tenant,
    actor,
    { invoiceId, ...ready.draft, pdf: ready.pdf },
    now,
  );
  return sent.ok ? { ok: true } : { ok: false, reason: "Der E-Mail-Versand ist fehlgeschlagen." };
}

/**
 * Hourly job: drafts every due period of every running contract (system
 * connection to find them, withTenant as the workspace's owner to write),
 * then follows the contract's send mode, or the workspace's when it has none.
 */
export async function runContractBilling(db: Database, now = new Date()) {
  const candidates = await db
    .select({ contract: maintenanceContracts })
    .from(maintenanceContracts)
    .innerJoin(
      prospects,
      and(
        eq(prospects.workspaceId, maintenanceContracts.workspaceId),
        eq(prospects.id, maintenanceContracts.prospectId),
      ),
    )
    .where(
      and(
        isNotNull(maintenanceContracts.startDate),
        isNull(prospects.restrictedAt),
        // The first unbilled day has come (a day of slack for time zones ahead of UTC).
        sql`coalesce(${maintenanceContracts.billedUntil} + 1, ${maintenanceContracts.startDate}) <= ${addDays(now.toISOString().slice(0, 10), 1)}`,
        or(
          isNull(maintenanceContracts.endDate),
          isNull(maintenanceContracts.billedUntil),
          lt(maintenanceContracts.billedUntil, maintenanceContracts.endDate),
        ),
      ),
    )
    .orderBy(
      sql`coalesce(${maintenanceContracts.billedUntil} + 1, ${maintenanceContracts.startDate})`,
    )
    .limit(500);

  const result = { drafted: 0, sent: 0, approvals: 0 };
  const settingsCache = new Map<string, Awaited<ReturnType<typeof loadWorkspaceSettings>>>();
  const ownerCache = new Map<string, string | null>();
  for (const { contract } of candidates) {
    try {
      let settings = settingsCache.get(contract.workspaceId);
      if (!settings) {
        settings = await loadWorkspaceSettings(db, contract.workspaceId);
        settingsCache.set(contract.workspaceId, settings);
      }
      const today = localDateString(now, settings.notifications.timezone);
      const due = duePeriods(termsOf(contract), today);
      if (due.length === 0) continue;
      if (!ownerCache.has(contract.workspaceId)) {
        ownerCache.set(contract.workspaceId, await workspaceOwner(db, contract.workspaceId));
      }
      const owner = ownerCache.get(contract.workspaceId);
      if (!owner) continue;
      const actor = { userId: owner, role: "owner" as const, workspaceId: contract.workspaceId };
      const mode = contract.sendMode ?? settings.billing.invoiceSendMode;
      for (const period of due) {
        const invoiceId = await withTenant(
          db,
          { userId: owner, workspaceId: contract.workspaceId },
          (tx) => billPeriod(tx, actor, contract.id, period),
        );
        if (!invoiceId) break;
        result.drafted++;
        if (mode === "manual") continue;
        let reason: string | undefined;
        if (mode === "auto") {
          // A throw (storage, database, provider) must still end in a task, or an
          // issued invoice could stay unsent without anyone knowing.
          const auto = await sendAutomatically(
            db,
            actor,
            invoiceId,
            contract.id,
            period,
            now,
          ).catch((error: unknown): AutoResult => {
            console.error("automatic invoice send failed", invoiceId, error);
            return { ok: false, reason: "Beim automatischen Versand ist ein Fehler aufgetreten." };
          });
          if (auto.ok) {
            result.sent++;
            continue;
          }
          reason = `Nicht automatisch gesendet: ${auto.reason}`;
        }
        await withTenant(db, { userId: owner, workspaceId: contract.workspaceId }, (tx) =>
          requestInvoiceApproval(tx, contract.workspaceId, invoiceId, now, reason),
        );
        result.approvals++;
      }
    } catch (error) {
      console.error("contract billing failed", contract.id, error);
    }
  }
  return result;
}
