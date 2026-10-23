import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import { withTenant, type Database, type Transaction } from "@/db";
import {
  auditLog,
  invoicePayments,
  invoiceReminders,
  invoices,
  outboundEmails,
  prospects,
  tasks,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { domainOf, messageIdFor, senderAddress } from "@/domain/email";
import {
  DUNNING_EMAIL_BODIES,
  DUNNING_EMAIL_SUBJECTS,
  DUNNING_LEVEL_LABELS,
  dunningClaim,
  dunningEmailValues,
  nextReminder,
  type DunningClaim,
  type DunningLevel,
  type DunningTerms,
} from "@/domain/invoices/dunning";
import { fillTemplate, mailFromText } from "@/domain/invoices/email";
import {
  INVOICE_KIND_LABELS,
  billingProfileSchema,
  type InvoiceParty,
} from "@/domain/invoices/schema";
import type { InvoiceTotals } from "@/domain/invoices/totals";
import { localDateString } from "@/domain/tasks";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { publish, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings, workspaceOwner } from "@/server/workspaces";
import { renderInvoicePdfOnServer } from "./pdf";
import { dropSettledReminders, paidCents } from "./reminder-drafts";
import {
  ensureInvoiceShare,
  invoicePath,
  loadIssued,
  recipientFor,
  replyToAddress,
  senderName,
  storeInvoicePdf,
  transmitMail,
} from "./send";

/**
 * Payment reminders and dunning letters (§7.10, phase 7c-4, ADR-0074). The
 * hourly job drafts the next due level of every overdue invoice and follows
 * the workspace's dunning mode; the owner can also prepare one by hand on
 * the invoice. A reminder goes out by e-mail with the stored invoice PDF.
 */

export type InvoiceReminder = typeof invoiceReminders.$inferSelect;
type Tenant = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

export function dunningTerms(settings: WorkspaceSettings): DunningTerms {
  const billing = settings.billing;
  return {
    days: billing.dunningDays,
    deadlineDays: billing.dunningDeadlineDays,
    lateInterest: billing.lateInterest,
    collectionFee: billing.collectionFee,
    baseRatePercent: billing.baseRatePercent,
  };
}

/** § 456 and § 458 UGB apply between businesses only. */
function isBusiness(prospect: typeof prospects.$inferSelect): boolean {
  const profile = billingProfileSchema.safeParse(prospect.billing ?? {});
  return !profile.success || profile.data.customerType === "business";
}

async function remindersOf(tx: Transaction, workspaceId: string, invoiceId: string) {
  return tx
    .select()
    .from(invoiceReminders)
    .where(
      and(eq(invoiceReminders.workspaceId, workspaceId), eq(invoiceReminders.invoiceId, invoiceId)),
    )
    .orderBy(asc(invoiceReminders.level));
}

/** Everything a reminder needs about its invoice, or why there is nothing to remind of. */
async function dunningContext(tx: Transaction, workspaceId: string, invoiceId: string, now: Date) {
  const row = await loadIssued(tx, workspaceId, invoiceId);
  if (!row || !row.invoice.number || !row.invoice.dueDate || !row.invoice.issueDate) return null;
  if (row.invoice.kind === "cancellation") return null;
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const totals = row.invoice.totals as InvoiceTotals;
  const open = Math.max(0, totals.dueCents - (await paidCents(tx, workspaceId, invoiceId)));
  return {
    ...row,
    number: row.invoice.number,
    dueDate: row.invoice.dueDate,
    issueDate: row.invoice.issueDate,
    settings,
    terms: dunningTerms(settings),
    today,
    openCents: open,
    business: isBusiness(row.prospect),
    /** Issued, not paid, past its due date and the customer not restricted. */
    remindable:
      row.invoice.status === "issued" &&
      open > 0 &&
      row.invoice.dueDate < today &&
      !row.prospect.restrictedAt,
  };
}
type DunningContext = NonNullable<Awaited<ReturnType<typeof dunningContext>>>;

function claimOf(context: DunningContext, level: DunningLevel): DunningClaim {
  return dunningClaim(
    {
      level,
      openCents: context.openCents,
      dueDate: context.dueDate,
      asOf: context.today,
      business: context.business,
    },
    context.terms,
  );
}

export type PrepareResult =
  | { ok: true; reminderId: string; level: DunningLevel }
  | { ok: false; error: "not_found" | "not_due" | "waiting" | "done" };

/**
 * Drafts the next level of an overdue invoice. The hourly job keeps to the
 * schedule (`scheduled`); by hand it may come earlier, but never before the
 * invoice is overdue and never while a draft waits.
 */
export async function prepareReminder(
  tx: Transaction,
  actor: Actor,
  invoiceId: string,
  now = new Date(),
  options: { scheduled?: boolean } = {},
): Promise<PrepareResult> {
  const context = await dunningContext(tx, actor.workspaceId, invoiceId, now);
  if (!context) return { ok: false, error: "not_found" };
  if (!context.remindable) return { ok: false, error: "not_due" };
  const reminders = await remindersOf(tx, actor.workspaceId, invoiceId);
  const next = nextReminder(context.dueDate, reminders, context.terms);
  if (!next) {
    return {
      ok: false,
      error: reminders.some((reminder) => reminder.status === "draft") ? "waiting" : "done",
    };
  }
  if (options.scheduled && next.dueOn > context.today) return { ok: false, error: "not_due" };
  const claim = claimOf(context, next.level);
  const [created] = await tx
    .insert(invoiceReminders)
    .values({
      workspaceId: actor.workspaceId,
      invoiceId,
      level: next.level,
      asOf: context.today,
      deadline: claim.deadline,
      openCents: claim.openCents,
      interestCents: claim.interestCents,
      interestRateBp: claim.interestRateBp,
      feeCents: claim.feeCents,
    })
    // Another run drafted the same level a moment ago.
    .onConflictDoNothing({ target: [invoiceReminders.invoiceId, invoiceReminders.level] })
    .returning({ id: invoiceReminders.id });
  if (!created) return { ok: false, error: "waiting" };
  await publish([workspaceTopic(actor.workspaceId)], "invoice.changed", {
    invoiceId,
    prospectId: context.prospect.id,
  });
  return { ok: true, reminderId: created.id, level: next.level };
}

/** Subject and text of a reminder's mail, filled for today. */
async function reminderDraft(
  tx: Transaction,
  context: DunningContext,
  level: DunningLevel,
): Promise<{ to: string; subject: string; body: string; claim: DunningClaim; link: string }> {
  const share = await ensureInvoiceShare(tx, context.workspace.id, context.invoice.id);
  const link = `${await workspacePublicOrigin(tx, context.workspace)}${invoicePath(share.token)}`;
  const claim = claimOf(context, level);
  const values = dunningEmailValues({
    kind: context.invoice.kind,
    number: context.number,
    issueDate: context.issueDate,
    dueDate: context.dueDate,
    asOf: context.today,
    claim,
    link,
    sender: senderName(context.settings, context.workspace.name),
    customer:
      (context.invoice.recipient as InvoiceParty | null)?.name ?? context.prospect.companyName,
  });
  return {
    to: await recipientFor(tx, context.prospect, context.invoice.id),
    subject: fillTemplate(DUNNING_EMAIL_SUBJECTS[level], values),
    body: fillTemplate(DUNNING_EMAIL_BODIES[level], values),
    claim,
    link,
  };
}

export interface InvoiceDunning {
  reminders: (InvoiceReminder & { emails: (typeof outboundEmails.$inferSelect)[] })[];
  /** The waiting draft with its mail, filled for today. */
  draft: {
    reminder: InvoiceReminder;
    claim: DunningClaim;
    mail: { to: string; subject: string; body: string };
    pdfStored: boolean;
    openApproval: boolean;
  } | null;
  /** The next level when no draft waits; `dueOn` is the hourly job's schedule. */
  next: { level: DunningLevel; dueOn: string } | null;
  remindable: boolean;
  openCents: number;
  mode: WorkspaceSettings["billing"]["dunningMode"];
}

/** What the invoice page shows under „Mahnungen“; null for invoices that cannot have any. */
export async function loadInvoiceDunning(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
  now = new Date(),
): Promise<InvoiceDunning | null> {
  const context = await dunningContext(tx, workspaceId, invoiceId, now);
  if (!context) return null;
  const reminders = await remindersOf(tx, workspaceId, invoiceId);
  if (!context.remindable && reminders.length === 0) return null;
  const emails = reminders.length
    ? await tx
        .select()
        .from(outboundEmails)
        .where(
          and(
            eq(outboundEmails.workspaceId, workspaceId),
            inArray(
              outboundEmails.reminderId,
              reminders.map((reminder) => reminder.id),
            ),
          ),
        )
        .orderBy(desc(outboundEmails.createdAt))
    : [];
  const waiting = reminders.find((reminder) => reminder.status === "draft") ?? null;
  let draft: InvoiceDunning["draft"] = null;
  if (waiting && context.remindable) {
    const mail = await reminderDraft(tx, context, waiting.level);
    const share = await ensureInvoiceShare(tx, workspaceId, invoiceId);
    const [approval] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.reminderId, waiting.id),
          isNull(tasks.doneAt),
        ),
      );
    draft = {
      reminder: waiting,
      claim: mail.claim,
      mail: { to: mail.to, subject: mail.subject, body: mail.body },
      pdfStored: share.pdfKey !== null,
      openApproval: Boolean(approval),
    };
  }
  return {
    reminders: reminders.map((reminder) => ({
      ...reminder,
      emails: emails.filter((mail) => mail.reminderId === reminder.id),
    })),
    draft,
    next: context.remindable ? nextReminder(context.dueDate, reminders, context.terms) : null,
    remindable: context.remindable,
    openCents: context.openCents,
    mode: context.settings.billing.dunningMode,
  };
}

/** Deletes a waiting draft (and with it its approval task). */
export async function discardReminder(
  tx: Transaction,
  actor: Actor,
  reminderId: string,
): Promise<{ invoiceId: string } | null> {
  const [removed] = await tx
    .delete(invoiceReminders)
    .where(
      and(
        eq(invoiceReminders.workspaceId, actor.workspaceId),
        eq(invoiceReminders.id, reminderId),
        eq(invoiceReminders.status, "draft"),
      ),
    )
    .returning({ invoiceId: invoiceReminders.invoiceId });
  return removed ?? null;
}

export type SendReminderResult =
  | { ok: true; level: DunningLevel }
  | {
      ok: false;
      error:
        | "not_found"
        | "settled"
        | "restricted"
        | "sending"
        | "pdf_missing"
        | "pdf_invalid"
        | "send_failed";
    };

/**
 * Sends a waiting reminder to `to`. The claim is recomputed for today and
 * frozen with the send; the approval task closes once the provider has the mail.
 */
export async function sendReminderEmail(
  tenant: Tenant,
  actor: Actor,
  input: { reminderId: string; to: string; subject: string; body: string; pdf: Uint8Array | null },
  now = new Date(),
): Promise<SendReminderResult> {
  const env = serverEnv();
  const prepared = await tenant(async (tx) => {
    const [reminder] = await tx
      .select()
      .from(invoiceReminders)
      .where(
        and(
          eq(invoiceReminders.workspaceId, actor.workspaceId),
          eq(invoiceReminders.id, input.reminderId),
          eq(invoiceReminders.status, "draft"),
        ),
      )
      .for("update");
    if (!reminder) return { ok: false as const, error: "not_found" as const };
    const context = await dunningContext(tx, actor.workspaceId, reminder.invoiceId, now);
    if (!context) return { ok: false as const, error: "not_found" as const };
    if (context.prospect.restrictedAt) return { ok: false as const, error: "restricted" as const };
    if (!context.remindable) {
      await dropSettledReminders(tx, actor.workspaceId, reminder.invoiceId);
      return { ok: false as const, error: "settled" as const };
    }
    const [inFlight] = await tx
      .select({ id: outboundEmails.id })
      .from(outboundEmails)
      .where(
        and(
          eq(outboundEmails.workspaceId, actor.workspaceId),
          eq(outboundEmails.reminderId, reminder.id),
          eq(outboundEmails.status, "sending"),
          // A row left "sending" by a crash must not block the reminder for good.
          gt(outboundEmails.createdAt, new Date(now.getTime() - 10 * 60_000)),
        ),
      );
    if (inFlight) return { ok: false as const, error: "sending" as const };
    const stored = await storeInvoicePdf(tx, actor.workspaceId, reminder.invoiceId, input.pdf);
    if (!stored.ok) return stored;
    const draft = await reminderDraft(tx, context, reminder.level);
    const claim = draft.claim;
    await tx
      .update(invoiceReminders)
      .set({
        asOf: context.today,
        deadline: claim.deadline,
        openCents: claim.openCents,
        interestCents: claim.interestCents,
        interestRateBp: claim.interestRateBp,
        feeCents: claim.feeCents,
      })
      .where(eq(invoiceReminders.id, reminder.id));
    const id = crypto.randomUUID();
    const domain = domainOf(env.EMAIL_FROM) ?? new URL(env.APP_URL).hostname;
    const messageId = messageIdFor(id, domain);
    const sender = senderName(context.settings, context.workspace.name);
    // Placeholders the owner typed are filled too, like in the invoice mail.
    const values = dunningEmailValues({
      kind: context.invoice.kind,
      number: context.number,
      issueDate: context.issueDate,
      dueDate: context.dueDate,
      asOf: context.today,
      claim,
      link: draft.link,
      sender,
      customer:
        (context.invoice.recipient as InvoiceParty | null)?.name ?? context.prospect.companyName,
    });
    const mail = mailFromText({
      subject: fillTemplate(input.subject, values),
      text: fillTemplate(input.body, values),
      link: draft.link,
    });
    await tx.insert(outboundEmails).values({
      id,
      workspaceId: actor.workspaceId,
      kind: "reminder",
      prospectId: context.prospect.id,
      projectId: context.invoice.projectId,
      invoiceId: context.invoice.id,
      reminderId: reminder.id,
      toAddress: input.to,
      subject: mail.subject,
      messageId,
      status: "sending",
      statusAt: now,
      sentBy: actor.userId,
      createdAt: now,
    });
    return {
      ok: true as const,
      id,
      messageId,
      to: input.to,
      mail,
      pdfKey: stored.pdfKey,
      number: context.number,
      level: reminder.level,
      invoiceId: context.invoice.id,
      prospectId: context.prospect.id,
      from: senderAddress(sender, env.EMAIL_FROM),
      replyTo: await replyToAddress(tx, actor.workspaceId, context.settings),
    };
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const sent = await transmitMail(tenant, actor.workspaceId, prepared);
  if (!sent.ok) return { ok: false, error: "send_failed" };

  await tenant(async (tx) => {
    await tx
      .update(invoiceReminders)
      .set({ status: "sent", sentAt: now, sentBy: actor.userId })
      .where(
        and(
          eq(invoiceReminders.workspaceId, actor.workspaceId),
          eq(invoiceReminders.id, input.reminderId),
        ),
      );
    await tx
      .update(tasks)
      .set({ doneAt: now })
      .where(
        and(
          eq(tasks.workspaceId, actor.workspaceId),
          eq(tasks.reminderId, input.reminderId),
          isNull(tasks.doneAt),
        ),
      );
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "invoice.reminder_sent",
      targetType: "invoice",
      targetId: prepared.invoiceId,
      meta: { prospectId: prepared.prospectId, number: prepared.number, level: prepared.level },
    });
  });
  await publish([workspaceTopic(actor.workspaceId)], "invoice.changed", {
    invoiceId: prepared.invoiceId,
    prospectId: prepared.prospectId,
  });
  return { ok: true, level: prepared.level };
}

/** „Zahlungserinnerung … freigeben“: a task on the customer that sending the reminder does. */
export async function requestReminderApproval(
  tx: Transaction,
  workspaceId: string,
  reminderId: string,
  now = new Date(),
  reason?: string,
): Promise<boolean> {
  const [row] = await tx
    .select({
      level: invoiceReminders.level,
      invoiceId: invoices.id,
      prospectId: invoices.prospectId,
      kind: invoices.kind,
      number: invoices.number,
    })
    .from(invoiceReminders)
    .innerJoin(
      invoices,
      and(
        eq(invoices.workspaceId, invoiceReminders.workspaceId),
        eq(invoices.id, invoiceReminders.invoiceId),
      ),
    )
    .where(and(eq(invoiceReminders.workspaceId, workspaceId), eq(invoiceReminders.id, reminderId)));
  if (!row) return false;
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  await tx.insert(tasks).values({
    workspaceId,
    prospectId: row.prospectId,
    invoiceId: row.invoiceId,
    reminderId,
    title:
      `${DUNNING_LEVEL_LABELS[row.level]} zur ${INVOICE_KIND_LABELS[row.kind]} ${row.number ?? ""} freigeben`
        .replace(/\s+/g, " ")
        .trim(),
    note: [reason, "Prüfen und per E-Mail senden. Die Aufgabe erledigt sich mit dem Versand."]
      .filter(Boolean)
      .join(" "),
    dueDate: localDateString(now, settings.notifications.timezone),
    reminder: "at_due",
  });
  return true;
}

type AutoResult = { ok: true } | { ok: false; reason: string };

/** „Automatisch“: sends the fresh draft as it is; any obstacle ends in an approval task. */
async function sendAutomatically(
  db: Database,
  actor: Actor,
  reminderId: string,
  now: Date,
): Promise<AutoResult> {
  const tenant: Tenant = (fn) =>
    withTenant(db, { userId: actor.userId, workspaceId: actor.workspaceId }, fn);
  const ready = await tenant(async (tx) => {
    const [reminder] = await tx
      .select()
      .from(invoiceReminders)
      .where(
        and(
          eq(invoiceReminders.workspaceId, actor.workspaceId),
          eq(invoiceReminders.id, reminderId),
        ),
      );
    if (!reminder) return { ok: false as const, reason: "Mahnung nicht gefunden." };
    const context = await dunningContext(tx, actor.workspaceId, reminder.invoiceId, now);
    if (!context?.remindable) return { ok: false as const, reason: "Rechnung nicht mehr offen." };
    const draft = await reminderDraft(tx, context, reminder.level);
    if (!draft.to) return { ok: false as const, reason: "Keine E-Mail-Adresse beim Kunden." };
    const share = await ensureInvoiceShare(tx, actor.workspaceId, reminder.invoiceId);
    let pdf: Uint8Array | null = null;
    if (!share.pdfKey) {
      const rendered = await renderInvoicePdfOnServer(tx, actor.workspaceId, reminder.invoiceId);
      if (!rendered.ok) {
        return {
          ok: false as const,
          reason:
            rendered.reason === "unavailable"
              ? "Die Rechnung wurde noch nie per E-Mail gesendet, und auf diesem Hosting kann der Server kein PDF erstellen."
              : rendered.reason === "logo"
                ? "Das Logo bitte unter Einstellungen → Marke neu hochladen, damit der Server es drucken kann."
                : "Das PDF der Rechnung konnte auf dem Server nicht erstellt werden.",
        };
      }
      pdf = rendered.bytes;
    }
    return {
      ok: true as const,
      mail: { to: draft.to, subject: draft.subject, body: draft.body },
      pdf,
    };
  });
  if (!ready.ok) return ready;
  const sent = await sendReminderEmail(
    tenant,
    actor,
    { reminderId, ...ready.mail, pdf: ready.pdf },
    now,
  );
  return sent.ok ? { ok: true } : { ok: false, reason: "Der E-Mail-Versand ist fehlgeschlagen." };
}

/**
 * Hourly job: finds overdue, unpaid invoices whose next level may be due
 * (system connection), drafts it as the workspace's owner and follows the
 * dunning mode. "off" leaves everything to the owner.
 */
export async function runDunning(db: Database, now = new Date()) {
  // A day of slack for time zones ahead of UTC; prepareReminder checks the local date.
  const horizon = now.toISOString().slice(0, 10);
  const candidates = await db
    .select({ id: invoices.id, workspaceId: invoices.workspaceId })
    .from(invoices)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, invoices.workspaceId), eq(prospects.id, invoices.prospectId)),
    )
    .where(
      and(
        eq(invoices.status, "issued"),
        ne(invoices.kind, "cancellation"),
        isNull(prospects.restrictedAt),
        sql`${invoices.dueDate} <= ${horizon}`,
        sql`(${invoices.totals}->>'dueCents')::int > coalesce((select sum(p.amount_cents) from ${invoicePayments} p where p.workspace_id = ${invoices.workspaceId} and p.invoice_id = ${invoices.id}), 0)`,
        // Nothing waits, the last letter is not out, and no deadline is still running.
        sql`not exists (select 1 from ${invoiceReminders} r where r.workspace_id = ${invoices.workspaceId} and r.invoice_id = ${invoices.id} and (r.status = 'draft' or r.level = 3 or r.deadline >= ${horizon}))`,
      ),
    )
    .orderBy(asc(invoices.dueDate))
    .limit(500);

  const result = { drafted: 0, sent: 0, approvals: 0 };
  const settingsCache = new Map<string, WorkspaceSettings>();
  const ownerCache = new Map<string, string | null>();
  for (const candidate of candidates) {
    try {
      let settings = settingsCache.get(candidate.workspaceId);
      if (!settings) {
        settings = await loadWorkspaceSettings(db, candidate.workspaceId);
        settingsCache.set(candidate.workspaceId, settings);
      }
      const mode = settings.billing.dunningMode;
      if (mode === "off") continue;
      if (!ownerCache.has(candidate.workspaceId)) {
        ownerCache.set(candidate.workspaceId, await workspaceOwner(db, candidate.workspaceId));
      }
      const owner = ownerCache.get(candidate.workspaceId);
      if (!owner) continue;
      const actor = { userId: owner, role: "owner" as const, workspaceId: candidate.workspaceId };
      const tenant: Tenant = (fn) =>
        withTenant(db, { userId: owner, workspaceId: candidate.workspaceId }, fn);
      const prepared = await tenant((tx) =>
        prepareReminder(tx, actor, candidate.id, now, { scheduled: true }),
      );
      if (!prepared.ok) continue;
      result.drafted++;
      if (mode === "manual") continue;
      let reason: string | undefined;
      if (mode === "auto") {
        const auto = await sendAutomatically(db, actor, prepared.reminderId, now).catch(
          (error: unknown): AutoResult => {
            console.error("automatic reminder send failed", prepared.reminderId, error);
            return { ok: false, reason: "Beim automatischen Versand ist ein Fehler aufgetreten." };
          },
        );
        if (auto.ok) {
          result.sent++;
          continue;
        }
        reason = `Nicht automatisch gesendet: ${auto.reason}`;
      }
      await tenant((tx) =>
        requestReminderApproval(tx, candidate.workspaceId, prepared.reminderId, now, reason),
      );
      result.approvals++;
    } catch (error) {
      console.error("dunning failed", candidate.id, error);
    }
  }
  return result;
}
