"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/authz";
import { issuesByField } from "@/domain/chat";
import { DUNNING_LEVEL_LABELS } from "@/domain/invoices/dunning";
import { discardReminder, prepareReminder, sendReminderEmail } from "@/server/invoices/dunning";
import { MAX_INVOICE_PDF_BYTES } from "@/server/invoices/send";
import { requireCockpit } from "@/server/session";

/** Cockpit side of payment reminders and dunning letters (§7.10, phase 7c-4). */

export interface DunningActionState {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
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

/** „Zahlungserinnerung vorbereiten“: drafts the next level now, ahead of the schedule. */
export async function prepareReminderAction(invoiceId: string): Promise<DunningActionState> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(invoiceId);
  if (!parsed.success) return { ok: false, message: "Rechnung nicht gefunden." };
  const result = await tenant((tx) => prepareReminder(tx, actor, parsed.data));
  revalidateInvoice(parsed.data);
  if (result.ok) return { ok: true, message: `${DUNNING_LEVEL_LABELS[result.level]} vorbereitet.` };
  const messages: Record<typeof result.error, string> = {
    not_found: "Rechnung nicht gefunden.",
    not_due: "Die Rechnung ist nicht überfällig oder schon bezahlt.",
    waiting: "Es wartet schon ein Entwurf.",
    done: "Die letzte Mahnung ist schon versendet.",
  };
  return { ok: false, message: messages[result.error] };
}

/** „Entwurf verwerfen“: the level pauses for one payment deadline. */
export async function discardReminderAction(reminderId: string): Promise<DunningActionState> {
  const { actor, tenant } = await manager();
  const parsed = id.safeParse(reminderId);
  if (!parsed.success) return { ok: false, message: "Mahnung nicht gefunden." };
  const skipped = await tenant((tx) => discardReminder(tx, actor, parsed.data));
  if (!skipped) return { ok: false, message: "Dieser Entwurf ist schon versendet oder verworfen." };
  revalidateInvoice(skipped.invoiceId);
  return {
    ok: true,
    message: `Verworfen. Der stündliche Job legt die Stufe frühestens nach dem ${skipped.until.split("-").reverse().join(".")} wieder an.`,
  };
}

const sendSchema = z.object({
  to: z.email("Bitte eine gültige E-Mail-Adresse angeben.").max(254),
  subject: z.string().trim().min(3, "Bitte einen Betreff angeben.").max(200),
  body: z.string().trim().min(10, "Bitte einen kurzen Text schreiben.").max(4000),
});

/** Sends the waiting reminder; the form carries the browser's PDF when none is stored yet. */
export async function sendReminderAction(formData: FormData): Promise<DunningActionState> {
  const { actor, tenant } = await manager();
  const reminderId = id.safeParse(text(formData, "reminderId"));
  const invoiceId = id.safeParse(text(formData, "invoiceId"));
  if (!reminderId.success || !invoiceId.success) {
    return { ok: false, message: "Mahnung nicht gefunden." };
  }
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
  const result = await sendReminderEmail(tenant, actor, {
    reminderId: reminderId.data,
    ...parsed.data,
    pdf,
    claimKey: text(formData, "claimKey") || null,
  });
  revalidateInvoice(invoiceId.data);
  if (result.ok) {
    return {
      ok: true,
      message: `${DUNNING_LEVEL_LABELS[result.level]} an ${parsed.data.to} gesendet.`,
    };
  }
  const messages: Record<typeof result.error, string> = {
    not_found: "Diese Mahnung ist schon versendet oder verworfen.",
    settled: "Die Rechnung ist inzwischen bezahlt oder storniert; der Entwurf ist verworfen.",
    restricted: "Für diesen Kunden gilt ein Sperrvermerk.",
    sending: "Diese Mahnung ist schon unterwegs.",
    changed:
      "Betrag oder Frist haben sich geändert, etwa durch eine Zahlung. Bitte den neuen Text prüfen und erneut senden.",
    pdf_missing: "Das PDF fehlt. Bitte erneut senden.",
    pdf_invalid: "Das PDF ist ungültig oder größer als 4 MB.",
    send_failed: "Die E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.",
  };
  return { ok: false, message: messages[result.error] };
}
