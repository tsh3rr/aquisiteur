"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import { invoicesCsv } from "@/domain/invoices/csv";
import { billingProfileSchema } from "@/domain/invoices/schema";
import { parseEuroInput } from "@/domain/offers/totals";
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  createInvoicesFromOffer,
  deleteInvoiceDraft,
  deletePayment,
  issueInvoice,
  listInvoices,
  monthCsvRows,
  saveBillingProfile,
  saveInvoiceDraft,
  billingProfileFor,
} from "@/server/invoices/manage";
import { printableInvoice } from "@/server/invoices/printable";
import { MAX_INVOICE_PDF_BYTES, sendInvoiceEmail } from "@/server/invoices/send";
import { checkVatId, type VatCheckOutcome } from "@/server/invoices/vat-check";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import type { PrintableInvoice } from "@/components/invoices/types";

/** Cockpit side of invoices (§7.10, phase 7b). */

export interface InvoiceActionResult {
  ok: boolean;
  message: string;
  issues?: { path?: string; message: string; level?: "error" | "warning" }[];
}

async function manager() {
  const context = await requireCockpit();
  assertCan(context.actor, "prospects.manage", { workspaceId: context.workspace.id });
  return context;
}

const MONTH_ARCHIVE_LIMIT = 200;

const id = z.uuid();
const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function revalidateInvoice(invoiceId: string) {
  revalidatePath(`/rechnungen/${invoiceId}`);
  revalidatePath("/rechnungen");
}

export async function createInvoiceAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const prospectId = id.parse(text(formData, "prospectId"));
  const projectId = text(formData, "projectId") ? id.parse(text(formData, "projectId")) : null;
  const created = await tenant((tx) => createInvoice(tx, actor, { prospectId, projectId }));
  if (!created) redirect("/rechnungen");
  redirect(`/rechnungen/${created}`);
}

export async function createInvoicesFromOfferAction(offerId: string): Promise<InvoiceActionResult> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(offerId);
  if (!parsed.success) return { ok: false, message: "Angebot nicht gefunden." };
  const result = await tenant((tx) => createInvoicesFromOffer(tx, actor, parsed.data));
  if ("error" in result) {
    return {
      ok: false,
      message:
        result.error === "not_accepted"
          ? "Rechnungen entstehen erst aus einem angenommenen Angebot."
          : result.error === "nothing_left"
            ? "Für alle Tranchen dieses Angebots gibt es schon Rechnungen."
            : "Angebot nicht gefunden.",
    };
  }
  revalidatePath("/rechnungen");
  revalidatePath(`/angebote/${parsed.data}`);
  return {
    ok: true,
    message:
      result.created === 1
        ? "1 Rechnungsentwurf angelegt."
        : `${result.created} Rechnungsentwürfe angelegt.`,
  };
}

export async function saveInvoiceDraftAction(
  invoiceId: string,
  document: unknown,
): Promise<InvoiceActionResult> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, message: "Rechnung nicht gefunden." };
  const saved = await tenant((tx) => saveInvoiceDraft(tx, actor, parsed.data, document));
  if (!saved.ok) {
    return {
      ok: false,
      message:
        saved.error === "invalid"
          ? "Bitte prüfen Sie die markierten Angaben."
          : saved.error === "locked"
            ? "Ausgestellte Rechnungen lassen sich nicht mehr ändern."
            : "Rechnung nicht gefunden.",
      issues: saved.issues,
    };
  }
  revalidateInvoice(parsed.data);
  return { ok: true, message: "Entwurf gespeichert." };
}

/** Saves the draft, then issues it. */
export async function issueInvoiceAction(
  invoiceId: string,
  document: unknown,
): Promise<InvoiceActionResult> {
  const saved = await saveInvoiceDraftAction(invoiceId, document);
  if (!saved.ok) return saved;
  const { actor, tenant } = await manager();
  const result = await tenant((tx) => issueInvoice(tx, actor, invoiceId));
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error === "invalid"
          ? "Die Rechnung ist noch nicht vollständig."
          : result.error === "locked"
            ? "Diese Rechnung ist schon ausgestellt."
            : "Rechnung nicht gefunden.",
      issues: result.issues,
    };
  }
  revalidateInvoice(invoiceId);
  return { ok: true, message: `Rechnung ${result.number} ist ausgestellt.` };
}

export async function cancelInvoiceAction(invoiceId: string): Promise<InvoiceActionResult> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, message: "Rechnung nicht gefunden." };
  const result = await tenant((tx) => cancelInvoice(tx, actor, parsed.data));
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error === "locked"
          ? "Nur ausgestellte Rechnungen lassen sich stornieren."
          : result.error === "deducted"
            ? `Die Schlussrechnung ${result.by ?? ""} zieht diese Anzahlung ab. Stornieren Sie zuerst die Schlussrechnung.`
            : "Rechnung nicht gefunden.",
    };
  }
  revalidateInvoice(parsed.data);
  revalidatePath(`/rechnungen/${result.id}`);
  return { ok: true, message: `Storniert mit ${result.number}.` };
}

export async function deleteInvoiceDraftAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const invoiceId = id.parse(text(formData, "id"));
  const deleted = await tenant((tx) => deleteInvoiceDraft(tx, actor, invoiceId));
  revalidatePath("/rechnungen");
  redirect(deleted?.projectId ? `/projekte/${deleted.projectId}` : "/rechnungen");
}

const paymentSchema = z.object({
  amountCents: z.number().int().min(1, "Bitte einen Betrag angeben.").max(100_000_000),
  paidOn: z.iso.date({ error: "Bitte ein Datum angeben." }),
  note: z.string().trim().max(200).optional(),
});

export interface PaymentState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

export async function addPaymentAction(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const { actor, tenant } = await manager();
  const invoiceId = id.safeParse(text(formData, "invoiceId"));
  if (!invoiceId.success) return { ok: false, message: "Rechnung nicht gefunden." };
  const parsed = paymentSchema.safeParse({
    amountCents: parseEuroInput(text(formData, "amount")) ?? Number.NaN,
    paidOn: text(formData, "paidOn"),
    note: text(formData, "note") || undefined,
  });
  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    return {
      ok: false,
      message: "Bitte prüfen Sie die markierten Felder.",
      errors: { amount: errors.amountCents ?? "", paidOn: errors.paidOn ?? "" },
    };
  }
  const result = await tenant((tx) => addPayment(tx, actor, invoiceId.data, parsed.data));
  if (result !== "ok") {
    return {
      ok: false,
      message:
        result === "locked"
          ? "Zahlungen gibt es nur für ausgestellte Rechnungen."
          : "Rechnung nicht gefunden.",
    };
  }
  revalidateInvoice(invoiceId.data);
  return { ok: true, message: "Zahlung erfasst." };
}

export async function deletePaymentAction(formData: FormData) {
  const { actor, tenant } = await manager();
  const paymentId = id.parse(text(formData, "id"));
  const invoiceId = await tenant((tx) => deletePayment(tx, actor, paymentId));
  if (invoiceId) revalidateInvoice(invoiceId);
}

export interface BillingProfileState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

/** Customer → Stammdaten → Rechnungsprofil. */
export async function saveBillingProfileAction(
  _prev: BillingProfileState,
  formData: FormData,
): Promise<BillingProfileState> {
  const { actor, tenant } = await manager();
  const prospectId = id.safeParse(text(formData, "prospectId"));
  if (!prospectId.success) return { ok: false, message: "Kunde nicht gefunden." };
  const terms = text(formData, "paymentTermsDays");
  const parsed = billingProfileSchema.safeParse({
    customerType: text(formData, "customerType") || "business",
    name: text(formData, "name"),
    street: text(formData, "street"),
    postalCode: text(formData, "postalCode"),
    city: text(formData, "city"),
    country: text(formData, "country"),
    vatId: text(formData, "vatId"),
    email: text(formData, "email"),
    paymentTermsDays: terms === "" ? undefined : Number(terms),
  });
  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    if (errors.country) errors.country = "Bitte den Ländercode angeben, z. B. AT oder DE.";
    if (errors.paymentTermsDays) errors.paymentTermsDays = "Bitte 0 bis 120 Tage angeben.";
    return { ok: false, message: "Bitte prüfen Sie die markierten Felder.", errors };
  }
  const profile = parsed.data;
  // Reverse charge needs a valid UID; VIES is asked whenever the UID is saved.
  let check: VatCheckOutcome | null = null;
  if (profile.vatId && profile.customerType === "business") {
    const settings = await tenant((tx) => loadWorkspaceSettings(tx, actor.workspaceId));
    check = await checkVatId(profile.vatId, settings.billing.vatId);
    if (check.status === "valid" || check.status === "invalid") profile.vatCheck = check.check;
  }
  if (!profile.vatCheck && profile.vatId) {
    // Without an answer from VIES, the last check of the same UID stays as proof.
    const previous = await tenant((tx) =>
      billingProfileFor(tx, actor.workspaceId, prospectId.data),
    );
    if (previous?.vatCheck?.vatId === profile.vatId) profile.vatCheck = previous.vatCheck;
  }
  const saved = await tenant((tx) => saveBillingProfile(tx, actor, prospectId.data, profile));
  if (!saved) return { ok: false, message: "Kunde nicht gefunden." };
  revalidatePath(`/kunden/${prospectId.data}`);
  if (check?.status === "valid") {
    return {
      ok: true,
      message: `Rechnungsprofil gespeichert. UID laut VIES gültig${check.check.consultationNumber ? ` (Abfrage ${check.check.consultationNumber})` : ""}.`,
    };
  }
  if (check?.status === "invalid") {
    return {
      ok: false,
      message: "Rechnungsprofil gespeichert, aber die UID ist laut VIES ungültig.",
      errors: { vatId: "Laut VIES ungültig. Bitte beim Kunden nachfragen." },
    };
  }
  if (check?.status === "unavailable") {
    return {
      ok: true,
      message:
        "Rechnungsprofil gespeichert. VIES ist gerade nicht erreichbar, bitte später erneut speichern.",
    };
  }
  return { ok: true, message: "Rechnungsprofil gespeichert." };
}

/** Everything the PDF needs, with the EPC QR code as a path (rendered in the browser). */
export async function loadInvoicePdfAction(invoiceId: string): Promise<PrintableInvoice | null> {
  const { workspace, tenant } = await requireCockpit();
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return null;
  return tenant((tx) => printableInvoice(tx, workspace.id, parsed.data));
}

export type MonthArchive =
  { ok: true; csv: string; invoices: PrintableInvoice[] } | { ok: false; message: string };

/** „ZIP für Oktober 2026“: the CSV and every issued invoice of the month, rendered in the browser. */
export async function loadMonthArchiveAction(month: string): Promise<MonthArchive> {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { ok: false, message: "Ungültiger Monat." };
  return tenant(async (tx) => {
    const rows = await monthCsvRows(tx, workspace.id, month);
    const list = await listInvoices(tx, workspace.id, { month });
    const issued = list.filter((row) => row.number);
    if (issued.length > MONTH_ARCHIVE_LIMIT) {
      return {
        ok: false as const,
        message: `Mehr als ${MONTH_ARCHIVE_LIMIT} Rechnungen in einem Monat: Bitte die PDFs einzeln laden.`,
      };
    }
    const invoices: PrintableInvoice[] = [];
    for (const row of issued) {
      const printable = await printableInvoice(tx, workspace.id, row.id);
      if (printable) invoices.push(printable);
    }
    return { ok: true as const, csv: invoicesCsv(rows), invoices };
  });
}

export interface SendInvoiceState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
}

const sendSchema = z.object({
  to: z.email("Bitte eine gültige E-Mail-Adresse angeben.").max(254),
  subject: z.string().trim().min(3, "Bitte einen Betreff angeben.").max(200),
  body: z.string().trim().min(10, "Bitte einen kurzen Text schreiben.").max(4000),
});

/**
 * Sends an issued invoice by e-mail (§7.10, 7c-2). The form carries the PDF
 * the browser rendered; it is stored with the first mail and reused after.
 */
export async function sendInvoiceAction(formData: FormData): Promise<SendInvoiceState> {
  const { actor, tenant } = await manager();
  const invoiceId = id.safeParse(text(formData, "invoiceId"));
  if (!invoiceId.success) return { ok: false, message: "Rechnung nicht gefunden." };
  const parsed = sendSchema.safeParse({
    to: text(formData, "to").trim(),
    subject: text(formData, "subject"),
    body: text(formData, "body"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Bitte prüfen Sie die markierten Felder.",
      errors: issuesByField(parsed.error),
    };
  }
  const file = formData.get("pdf");
  const pdf =
    file instanceof File && file.size > 0 && file.size <= MAX_INVOICE_PDF_BYTES
      ? new Uint8Array(await file.arrayBuffer())
      : null;
  const result = await sendInvoiceEmail(tenant, actor, {
    invoiceId: invoiceId.data,
    ...parsed.data,
    pdf,
  });
  revalidateInvoice(invoiceId.data);
  if (result.ok) return { ok: true, message: `Rechnung an ${parsed.data.to} gesendet.` };
  const messages: Record<typeof result.error, string> = {
    not_found: "Nur ausgestellte Rechnungen lassen sich senden.",
    restricted: "Für diesen Kunden gilt ein Sperrvermerk.",
    pdf_missing: "Das PDF fehlt. Bitte erneut senden.",
    pdf_invalid: "Das PDF ist ungültig oder größer als 4 MB.",
    send_failed: "Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.",
  };
  return { ok: false, message: messages[result.error] };
}
