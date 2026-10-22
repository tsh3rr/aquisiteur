"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import { epcPayload } from "@/domain/invoices/epc";
import { billingProfileSchema } from "@/domain/invoices/schema";
import { parseEuroInput } from "@/domain/offers/totals";
import { modulesPath } from "@/domain/tracking/qr";
import {
  addPayment,
  cancelInvoice,
  createInvoice,
  createInvoicesFromOffer,
  deleteInvoiceDraft,
  deletePayment,
  issueInvoice,
  loadInvoice,
  saveBillingProfile,
  saveInvoiceDraft,
} from "@/server/invoices/manage";
import { requireCockpit } from "@/server/session";
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
  const saved = await tenant((tx) => saveBillingProfile(tx, actor, prospectId.data, parsed.data));
  if (!saved) return { ok: false, message: "Kunde nicht gefunden." };
  revalidatePath(`/kunden/${prospectId.data}`);
  return { ok: true, message: "Rechnungsprofil gespeichert." };
}

/** Everything the PDF needs, with the EPC QR code as a path (rendered in the browser). */
export async function loadInvoicePdfAction(invoiceId: string): Promise<PrintableInvoice | null> {
  const { workspace, tenant } = await requireCockpit();
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return null;
  const loaded = await tenant((tx) => loadInvoice(tx, workspace.id, parsed.data));
  if (!loaded) return null;
  const { invoice, issuer, recipient, totals, document } = loaded;
  const payload =
    issuer.iban && invoice.number && invoice.kind !== "cancellation"
      ? epcPayload({
          name: issuer.name,
          iban: issuer.iban,
          bic: issuer.bic,
          amountCents: totals.dueCents,
          reference: invoice.number,
        })
      : null;
  return {
    kind: invoice.kind,
    status: invoice.status,
    number: invoice.number,
    issueDate: invoice.issueDate ?? loaded.today,
    dueDate: invoice.dueDate,
    document,
    totals,
    issuer,
    recipient,
    taxNote: loaded.taxNote,
    cancels: loaded.cancels?.number ?? null,
    offerNumber: loaded.offer?.number ?? null,
    qr: payload ? modulesPath(payload) : null,
  };
}
