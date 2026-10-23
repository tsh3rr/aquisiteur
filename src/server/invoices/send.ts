import "server-only";
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { serverEnv } from "@/config/env";
import type { Database, Transaction } from "@/db";
import {
  auditLog,
  contacts,
  invoicePayments,
  invoiceShares,
  invoices,
  memberships,
  outboundEmails,
  prospects,
  tasks,
  users,
  workspaces,
} from "@/db/schema";
import type { Actor } from "@/domain/authz";
import { randomCode } from "@/domain/codes";
import {
  EMAIL_PROBLEMS,
  domainOf,
  messageIdFor,
  nextEmailStatus,
  senderAddress,
  type EmailStatus,
} from "@/domain/email";
import { fillTemplate, invoiceEmail, invoiceEmailValues } from "@/domain/invoices/email";
import { INVOICE_KIND_LABELS, billingProfileSchema } from "@/domain/invoices/schema";
import { paymentState, type InvoiceTotals } from "@/domain/invoices/totals";
import type { InvoiceIssuer, InvoiceParty, TaxTreatment } from "@/domain/invoices/schema";
import { localDateString } from "@/domain/tasks";
import type { WorkspaceSettings } from "@/domain/workspace-settings";
import { getInfra } from "@/infra";
import type { EmailEvent } from "@/infra";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { publish, workspaceTopic } from "@/server/realtime";
import { loadWorkspaceSettings } from "@/server/workspaces";

/**
 * Invoices by e-mail (§7.10, phase 7c-2, ADR-0072). The PDF is rendered in
 * the browser and stored the first time an invoice is sent; every later mail
 * and the customer's page `/r/<token>` hand out that same file. A mail is
 * recorded before it leaves (status "sending"), sent outside any transaction,
 * then marked sent; the provider's webhooks move it on from there.
 */

export const MAX_INVOICE_PDF_BYTES = 4 * 1024 * 1024;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function invoicePdfKey(workspaceId: string, invoiceId: string): string {
  return `${workspaceId}/invoices/${invoiceId}.pdf`;
}

export function invoicePath(token: string): `/r/${string}` {
  return `/r/${token}`;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

/** The share row of an issued invoice, created on first use. */
export async function ensureInvoiceShare(tx: Transaction, workspaceId: string, invoiceId: string) {
  await tx
    .insert(invoiceShares)
    .values({ workspaceId, invoiceId, token: randomCode(22, BASE62) })
    .onConflictDoNothing({ target: invoiceShares.invoiceId });
  const [share] = await tx
    .select()
    .from(invoiceShares)
    .where(and(eq(invoiceShares.workspaceId, workspaceId), eq(invoiceShares.invoiceId, invoiceId)));
  return share!;
}

/**
 * Where a customer's reply goes: the workspace's contact address, else the
 * owner's sign-in address. One place, so the inbox can rely on it later.
 */
export async function replyToAddress(
  db: Database | Transaction,
  workspaceId: string,
  settings: WorkspaceSettings,
): Promise<string | null> {
  if (settings.channels.email) return settings.channels.email;
  const [owner] = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  return owner?.email ?? null;
}

function senderName(settings: WorkspaceSettings, workspaceName: string): string {
  return settings.senderAddress.company ?? settings.profile.displayName ?? workspaceName;
}

async function loadIssued(tx: Transaction, workspaceId: string, invoiceId: string) {
  const [row] = await tx
    .select({ invoice: invoices, prospect: prospects, workspace: workspaces })
    .from(invoices)
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, invoices.workspaceId), eq(prospects.id, invoices.prospectId)),
    )
    .innerJoin(workspaces, eq(workspaces.id, invoices.workspaceId))
    .where(
      and(
        eq(invoices.workspaceId, workspaceId),
        eq(invoices.id, invoiceId),
        ne(invoices.status, "draft"),
      ),
    );
  return row ?? null;
}

async function defaultRecipient(
  tx: Transaction,
  prospect: typeof prospects.$inferSelect,
): Promise<string> {
  const profile = billingProfileSchema.safeParse(prospect.billing ?? {});
  if (profile.success && profile.data.email) return profile.data.email;
  if (prospect.email) return prospect.email;
  const [contact] = await tx
    .select({ email: contacts.email })
    .from(contacts)
    .where(
      and(eq(contacts.workspaceId, prospect.workspaceId), eq(contacts.prospectId, prospect.id)),
    )
    .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt));
  return contact?.email ?? "";
}

export interface InvoiceDelivery {
  url: string;
  pdfStored: boolean;
  firstViewedAt: Date | null;
  draft: { to: string; subject: string; body: string };
  emails: (typeof outboundEmails.$inferSelect)[];
  /** Approval tasks still open for this invoice. */
  openApprovals: number;
}

/** What the invoice page shows under „Versand“; creates the share on first view. */
export async function loadInvoiceDelivery(
  tx: Transaction,
  workspaceId: string,
  invoiceId: string,
): Promise<InvoiceDelivery | null> {
  const row = await loadIssued(tx, workspaceId, invoiceId);
  if (!row || !row.invoice.number) return null;
  const { invoice, prospect, workspace } = row;
  const number = row.invoice.number;
  const settings = await loadWorkspaceSettings(tx, workspaceId);
  const share = await ensureInvoiceShare(tx, workspaceId, invoiceId);
  const url = `${await workspacePublicOrigin(tx, workspace)}${invoicePath(share.token)}`;
  const totals = invoice.totals as InvoiceTotals;
  const values = invoiceEmailValues({
    kind: invoice.kind,
    number,
    dueCents: totals.dueCents,
    dueDate: invoice.kind === "cancellation" ? null : invoice.dueDate,
    link: url,
    sender: senderName(settings, workspace.name),
    customer: (invoice.recipient as InvoiceParty | null)?.name ?? prospect.companyName,
  });
  const [emails, approvals] = await Promise.all([
    tx
      .select()
      .from(outboundEmails)
      .where(
        and(eq(outboundEmails.workspaceId, workspaceId), eq(outboundEmails.invoiceId, invoiceId)),
      )
      .orderBy(desc(outboundEmails.createdAt)),
    tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          eq(tasks.invoiceId, invoiceId),
          isNull(tasks.doneAt),
        ),
      ),
  ]);
  return {
    url,
    pdfStored: share.pdfKey !== null,
    firstViewedAt: share.firstViewedAt,
    draft: {
      to: await defaultRecipient(tx, prospect),
      subject: fillTemplate(settings.billing.invoiceEmailSubject, values),
      body: fillTemplate(settings.billing.invoiceEmailBody, values),
    },
    emails,
    openApprovals: approvals.length,
  };
}

async function readAll(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export type SendInvoiceResult =
  | { ok: true; emailId: string }
  | {
      ok: false;
      error: "not_found" | "restricted" | "pdf_missing" | "pdf_invalid" | "send_failed";
      detail?: string;
    };

/**
 * Sends an issued invoice to `to`. `pdf` is the browser's rendering and is
 * only used (and required) when no PDF is stored yet. Open approval tasks of
 * the invoice are done once the provider has accepted the mail.
 */
export async function sendInvoiceEmail(
  tenant: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>,
  actor: Actor,
  input: { invoiceId: string; to: string; subject: string; body: string; pdf: Uint8Array | null },
  now = new Date(),
): Promise<SendInvoiceResult> {
  const env = serverEnv();
  const prepared = await tenant(async (tx) => {
    const row = await loadIssued(tx, actor.workspaceId, input.invoiceId);
    if (!row || !row.invoice.number) return { ok: false as const, error: "not_found" as const };
    if (row.prospect.restrictedAt) return { ok: false as const, error: "restricted" as const };
    const share = await ensureInvoiceShare(tx, actor.workspaceId, input.invoiceId);
    let pdfKey = share.pdfKey;
    if (!pdfKey) {
      if (!input.pdf) return { ok: false as const, error: "pdf_missing" as const };
      if (!isPdf(input.pdf) || input.pdf.byteLength > MAX_INVOICE_PDF_BYTES) {
        return { ok: false as const, error: "pdf_invalid" as const };
      }
      pdfKey = invoicePdfKey(actor.workspaceId, input.invoiceId);
      await getInfra().storage.put(pdfKey, input.pdf, {
        contentType: "application/pdf",
        cacheControl: "private, no-store",
      });
      await tx
        .update(invoiceShares)
        .set({ pdfKey, pdfBytes: input.pdf.byteLength })
        .where(
          and(
            eq(invoiceShares.workspaceId, actor.workspaceId),
            eq(invoiceShares.invoiceId, input.invoiceId),
          ),
        );
    }
    const settings = await loadWorkspaceSettings(tx, actor.workspaceId);
    const id = crypto.randomUUID();
    const domain = domainOf(env.EMAIL_FROM) ?? new URL(env.APP_URL).hostname;
    const messageId = messageIdFor(id, domain);
    const origin = await workspacePublicOrigin(tx, row.workspace);
    const link = `${origin}${invoicePath(share.token)}`;
    const totals = row.invoice.totals as InvoiceTotals;
    const sender = senderName(settings, row.workspace.name);
    const mail = invoiceEmail({
      kind: row.invoice.kind,
      number: row.invoice.number,
      dueCents: totals.dueCents,
      dueDate: row.invoice.kind === "cancellation" ? null : row.invoice.dueDate,
      link,
      sender,
      customer: (row.invoice.recipient as InvoiceParty | null)?.name ?? row.prospect.companyName,
      subject: input.subject,
      body: input.body,
    });
    await tx.insert(outboundEmails).values({
      id,
      workspaceId: actor.workspaceId,
      kind: "invoice",
      prospectId: row.prospect.id,
      projectId: row.invoice.projectId,
      invoiceId: row.invoice.id,
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
      mail,
      pdfKey,
      number: row.invoice.number,
      prospectId: row.prospect.id,
      from: senderAddress(sender, env.EMAIL_FROM),
      replyTo: await replyToAddress(tx, actor.workspaceId, settings),
    };
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  let providerId: string | null;
  try {
    const stored = await getInfra().storage.get(prepared.pdfKey);
    if (!stored) throw new Error("stored invoice PDF is missing");
    const pdf = await readAll(stored.body);
    ({ id: providerId } = await getInfra().email.send({
      to: input.to,
      from: prepared.from,
      ...(prepared.replyTo ? { replyTo: prepared.replyTo } : {}),
      subject: prepared.mail.subject,
      text: prepared.mail.text,
      html: prepared.mail.html,
      headers: { "Message-ID": prepared.messageId },
      attachments: [
        { filename: `${prepared.number}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
    }));
    await tenant((tx) =>
      tx
        .update(outboundEmails)
        .set({ attachmentBytes: pdf.byteLength })
        .where(eq(outboundEmails.id, prepared.id)),
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "unknown error";
    await tenant((tx) =>
      tx
        .update(outboundEmails)
        .set({ status: "failed", statusAt: new Date(), error: detail })
        .where(
          and(
            eq(outboundEmails.workspaceId, actor.workspaceId),
            eq(outboundEmails.id, prepared.id),
          ),
        ),
    );
    return { ok: false, error: "send_failed", detail };
  }

  await tenant(async (tx) => {
    await tx
      .update(outboundEmails)
      .set({ providerId, status: "sent", statusAt: new Date() })
      .where(
        and(
          eq(outboundEmails.workspaceId, actor.workspaceId),
          eq(outboundEmails.id, prepared.id),
          eq(outboundEmails.status, "sending"),
        ),
      );
    await tx
      .update(tasks)
      .set({ doneAt: now })
      .where(
        and(
          eq(tasks.workspaceId, actor.workspaceId),
          eq(tasks.invoiceId, input.invoiceId),
          isNull(tasks.doneAt),
        ),
      );
    await tx.insert(auditLog).values({
      workspaceId: actor.workspaceId,
      actorUserId: actor.userId,
      action: "invoice.sent",
      targetType: "invoice",
      targetId: input.invoiceId,
      // No address in the audit log: it outlives a Sperrvermerk, the mail row does not.
      meta: { prospectId: prepared.prospectId, number: prepared.number },
    });
  });
  await publish([workspaceTopic(actor.workspaceId)], "invoice.changed", {
    invoiceId: input.invoiceId,
    prospectId: prepared.prospectId,
  });
  return { ok: true, emailId: prepared.id };
}

/**
 * „Rechnung freigeben“ (§7.10): a task on the invoice's customer that the
 * hourly job creates for drafts it prepared; sending the invoice does it.
 * Returns false when an open one exists already.
 */
export async function requestInvoiceApproval(
  db: Database | Transaction,
  workspaceId: string,
  invoiceId: string,
  now = new Date(),
  /** Why it was not sent automatically, shown first in the task's note. */
  reason?: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      id: invoices.id,
      prospectId: invoices.prospectId,
      kind: invoices.kind,
      number: invoices.number,
      document: invoices.document,
    })
    .from(invoices)
    .where(and(eq(invoices.workspaceId, workspaceId), eq(invoices.id, invoiceId)));
  if (!row) return false;
  const [open] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaceId), eq(tasks.invoiceId, invoiceId), isNull(tasks.doneAt)),
    );
  if (open) return false;
  const settings = await loadWorkspaceSettings(db, workspaceId);
  const title = (row.document as { title?: string }).title;
  await db.insert(tasks).values({
    workspaceId,
    prospectId: row.prospectId,
    invoiceId,
    title: `${INVOICE_KIND_LABELS[row.kind]} ${row.number ?? title ?? ""} freigeben`
      .replace(/\s+/g, " ")
      .trim(),
    note: [
      reason,
      row.number
        ? "Prüfen und per E-Mail senden. Die Aufgabe erledigt sich mit dem Versand."
        : "Prüfen, ausstellen und per E-Mail senden. Die Aufgabe erledigt sich mit dem Versand.",
    ]
      .filter(Boolean)
      .join(" "),
    dueDate: localDateString(now, settings.notifications.timezone),
    reminder: "at_due",
  });
  return true;
}

/**
 * Delivery webhooks (system connection): moves each mail's status forward,
 * never back, and puts a task on the customer when a mail did not arrive.
 */
export async function recordEmailEvents(
  db: Database,
  events: EmailEvent[],
  now = new Date(),
): Promise<{ changed: number; retry: boolean }> {
  let changed = 0;
  let retry = false;
  for (const event of events) {
    const [mail] = await db
      .select()
      .from(outboundEmails)
      .where(eq(outboundEmails.providerId, event.providerId));
    if (!mail) {
      // A fast event can beat the commit of the provider id; ask the provider to
      // retry while a fresh mail still waits for its id. Other mails (sign-in
      // links, digests) have no row and are dropped.
      retry ||= await awaitingProviderId(db, now);
      continue;
    }
    const next = nextEmailStatus(mail.status, event.status as EmailStatus);
    if (!next) continue;
    await db.transaction(async (tx) => {
      await tx
        .update(outboundEmails)
        .set({ status: next, statusAt: event.at, error: event.detail ?? mail.error })
        .where(
          and(eq(outboundEmails.workspaceId, mail.workspaceId), eq(outboundEmails.id, mail.id)),
        );
      if (!EMAIL_PROBLEMS.has(next) || !mail.invoiceId) return;
      const [invoice] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.workspaceId, mail.workspaceId), eq(invoices.id, mail.invoiceId)));
      const settings = await loadWorkspaceSettings(tx, mail.workspaceId);
      await tx.insert(tasks).values({
        workspaceId: mail.workspaceId,
        prospectId: mail.prospectId,
        title: `Rechnung ${invoice?.number ?? ""} nicht zugestellt: Adresse ${mail.toAddress} prüfen`,
        note: event.detail,
        dueDate: localDateString(now, settings.notifications.timezone),
        reminder: "at_due",
      });
      await tx.insert(auditLog).values({
        workspaceId: mail.workspaceId,
        actorUserId: null,
        action: "invoice.undelivered",
        targetType: "invoice",
        targetId: mail.invoiceId,
        meta: {
          prospectId: mail.prospectId,
          number: invoice?.number ?? null,
          status: next,
        },
      });
    });
    changed++;
    if (mail.invoiceId) {
      await publish([workspaceTopic(mail.workspaceId)], "invoice.changed", {
        invoiceId: mail.invoiceId,
        prospectId: mail.prospectId,
      });
    }
  }
  return { changed, retry };
}

const PENDING_WINDOW_MS = 10 * 60 * 1000;

async function awaitingProviderId(db: Database, now: Date): Promise<boolean> {
  const [pending] = await db
    .select({ id: outboundEmails.id })
    .from(outboundEmails)
    .where(
      and(
        eq(outboundEmails.status, "sending"),
        isNull(outboundEmails.providerId),
        gt(outboundEmails.createdAt, new Date(now.getTime() - PENDING_WINDOW_MS)),
      ),
    )
    .limit(1);
  return Boolean(pending);
}

export interface PublicInvoice {
  invoiceId: string;
  workspaceId: string;
  number: string;
  kind: (typeof invoices.$inferSelect)["kind"];
  status: (typeof invoices.$inferSelect)["status"];
  issueDate: string | null;
  dueDate: string | null;
  totals: InvoiceTotals;
  issuer: InvoiceIssuer;
  recipient: InvoiceParty;
  title: string | null;
  treatment: TaxTreatment;
  paidCents: number;
  displayStatus: ReturnType<typeof paymentState>;
  hasPdf: boolean;
  pdfKey: string | null;
  settings: WorkspaceSettings;
}

/**
 * The customer's invoice page (system connection, scoped to the host's
 * workspace, ADR-0012). Restricted customers (Sperrvermerk) have none.
 */
export async function loadPublicInvoice(
  db: Database,
  workspaceId: string,
  token: string,
  now = new Date(),
): Promise<PublicInvoice | null> {
  if (!/^[0-9A-Za-z]{22}$/.test(token)) return null;
  const [row] = await db
    .select({ share: invoiceShares, invoice: invoices })
    .from(invoiceShares)
    .innerJoin(
      invoices,
      and(
        eq(invoices.workspaceId, invoiceShares.workspaceId),
        eq(invoices.id, invoiceShares.invoiceId),
      ),
    )
    .innerJoin(
      prospects,
      and(eq(prospects.workspaceId, invoices.workspaceId), eq(prospects.id, invoices.prospectId)),
    )
    .where(
      and(
        eq(invoiceShares.workspaceId, workspaceId),
        eq(invoiceShares.token, token),
        ne(invoices.status, "draft"),
        isNull(prospects.restrictedAt),
      ),
    );
  if (!row || !row.invoice.number || !row.invoice.totals) return null;
  const { invoice, share } = row;
  const number = row.invoice.number;
  const payments = await db
    .select({ amountCents: invoicePayments.amountCents })
    .from(invoicePayments)
    .where(
      and(eq(invoicePayments.workspaceId, workspaceId), eq(invoicePayments.invoiceId, invoice.id)),
    );
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const settings = await loadWorkspaceSettings(db, workspaceId);
  const today = localDateString(now, settings.notifications.timezone);
  const totals = invoice.totals as InvoiceTotals;
  return {
    invoiceId: invoice.id,
    workspaceId,
    number,
    kind: invoice.kind,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totals,
    issuer: invoice.issuer as InvoiceIssuer,
    recipient: invoice.recipient as InvoiceParty,
    title: (invoice.document as { title?: string | null }).title ?? null,
    treatment: (invoice.document as { treatment: TaxTreatment }).treatment,
    paidCents,
    displayStatus: paymentState(
      {
        kind: invoice.kind,
        status: invoice.status,
        dueDate: invoice.dueDate,
        dueCents: totals.dueCents,
      },
      paidCents,
      today,
    ),
    hasPdf: share.pdfKey !== null,
    pdfKey: share.pdfKey,
    settings,
  };
}

/** First real view by the customer: no bots, not the owner's devices. */
export async function recordInvoiceView(
  db: Database,
  input: { workspaceId: string; invoiceId: string; quiet: boolean },
  now = new Date(),
): Promise<void> {
  if (input.quiet) return;
  await db
    .update(invoiceShares)
    .set({ firstViewedAt: now })
    .where(
      and(
        eq(invoiceShares.workspaceId, input.workspaceId),
        eq(invoiceShares.invoiceId, input.invoiceId),
        isNull(invoiceShares.firstViewedAt),
      ),
    );
}
