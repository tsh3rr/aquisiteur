import type { InvoiceKind } from "./schema";
import { INVOICE_KIND_LABELS } from "./schema";
import { germanDate } from "./totals";
import { formatCents } from "../offers/totals";

/**
 * The mail that carries an invoice (§7.10, phase 7c-2): PDF attached, link to
 * the invoice page. Subject and text come from the workspace settings with
 * placeholders, so the owner writes them once in their own words.
 */

export const INVOICE_SEND_MODES = ["manual", "approval", "auto"] as const;
export type InvoiceSendMode = (typeof INVOICE_SEND_MODES)[number];

export const INVOICE_SEND_MODE_LABELS: Record<InvoiceSendMode, string> = {
  manual: "Manuell: Sie senden jede Rechnung selbst",
  approval: "Freigabe über eine Aufgabe",
  auto: "Automatisch für unveränderte Wartungsrechnungen",
};

export const INVOICE_EMAIL_SUBJECT = "{art} {nummer} von {absender}";
export const INVOICE_EMAIL_BODY = `Guten Tag,

anbei erhalten Sie die {art} {nummer} über {betrag}, zahlbar bis {faellig}.
Sie können sie auch online ansehen und herunterladen: {link}

Vielen Dank!
{absender}`;

export const INVOICE_EMAIL_PLACEHOLDERS = [
  "art",
  "nummer",
  "betrag",
  "faellig",
  "link",
  "absender",
  "kunde",
] as const;
type Placeholder = (typeof INVOICE_EMAIL_PLACEHOLDERS)[number];

export function fillTemplate<K extends string>(
  template: string,
  values: Record<K, string>,
): string {
  return template.replace(/\{([a-z]+)\}/g, (match, key: string) =>
    key in values ? values[key as K] : match,
  );
}

export interface InvoiceEmailInput {
  kind: InvoiceKind;
  number: string;
  dueCents: number;
  dueDate: string | null;
  link: string;
  sender: string;
  customer: string;
  subject: string;
  body: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function invoiceEmailValues(input: Omit<InvoiceEmailInput, "subject" | "body">) {
  return {
    art: INVOICE_KIND_LABELS[input.kind],
    nummer: input.number,
    betrag: formatCents(input.dueCents),
    faellig: input.dueDate ? germanDate(input.dueDate) : "sofort",
    link: input.link,
    absender: input.sender,
    kunde: input.customer,
  } satisfies Record<Placeholder, string>;
}

/** Subject, plain text and a minimal HTML twin; the link is clickable in both. */
export function mailFromText(input: { subject: string; text: string; link?: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  const text = input.text.trim();
  const link = input.link ? escapeHtml(input.link) : null;
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph).replace(/\n/g, "<br>");
      return `<p>${link ? escaped.split(link).join(`<a href="${link}">${link}</a>`) : escaped}</p>`;
    })
    .join("\n");
  const html = `<!doctype html><html lang="de"><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${paragraphs}</body></html>`;
  return { subject, text, html };
}

export function invoiceEmail(input: InvoiceEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const values = invoiceEmailValues(input);
  return mailFromText({
    subject: fillTemplate(input.subject, values),
    text: fillTemplate(input.body, values),
    link: input.link,
  });
}
