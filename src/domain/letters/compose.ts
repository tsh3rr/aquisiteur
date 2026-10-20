/**
 * Everything printed on a letter (§7.9), as plain data. The PDF component
 * only lays it out, so the text logic is tested without rendering a PDF.
 */

export interface LetterSender {
  /** Agency or owner name in the return address line. */
  company: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  /** The person signing. */
  name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

export interface LetterRecipient {
  companyName: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  contact: { salutation: string | null; firstName: string | null; lastName: string | null } | null;
}

export interface LetterInput {
  sender: LetterSender;
  recipient: LetterRecipient;
  subject: string;
  body: string;
  closing: string;
  qrHint: string;
  /** Typed link as printed, e.g. "pixelwerk.de/k7m2"; null without short code. */
  shortLink: string | null;
  /** What the QR code opens. */
  qrUrl: string;
  date: Date;
  timeZone: string;
  signatureUrl: string | null;
}

export interface ComposedLetter {
  /** One small line above the address (DIN 5008 Rücksendeangabe). */
  returnAddress: string;
  /** Up to six lines in the window. */
  address: string[];
  date: string;
  subject: string;
  /** Null when the body brings its own salutation. */
  salutation: string | null;
  body: string;
  closing: string;
  /** Agency or owner name for the letterhead. */
  senderName: string;
  signer: { name: string | null; role: string | null; signatureUrl: string | null };
  qr: { url: string; hint: string; shortLink: string | null };
  /** Phone, e-mail and website, one per line in the info block. */
  senderContact: string[];
  /** Contact details in the footer. */
  footer: string[];
  /** Placeholders the text used that had no value, e.g. ["ansprechpartner"]. */
  missing: string[];
}

const COUNTRY_NAMES: Record<string, string> = {
  AT: "ÖSTERREICH",
  CH: "SCHWEIZ",
  DE: "DEUTSCHLAND",
  LU: "LUXEMBURG",
  NL: "NIEDERLANDE",
};

/** "Frau Anna Müller" / "Herr Müller" / null. */
export function contactName(contact: LetterRecipient["contact"]): string | null {
  if (!contact) return null;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  if (!name) return null;
  return contact.salutation ? `${contact.salutation} ${name}` : name;
}

export function salutationFor(contact: LetterRecipient["contact"]): string {
  if (contact?.lastName && contact.salutation === "Frau") {
    return `Sehr geehrte Frau ${contact.lastName},`;
  }
  if (contact?.lastName && contact.salutation === "Herr") {
    return `Sehr geehrter Herr ${contact.lastName},`;
  }
  if (contact?.lastName) {
    return `Guten Tag ${[contact.firstName, contact.lastName].filter(Boolean).join(" ")},`;
  }
  return "Sehr geehrte Damen und Herren,";
}

const OWN_SALUTATION = /^(sehr geehrte[rs]?|liebe[rs]?|hallo|guten tag|moin|servus|grüß gott)\b/i;

/** Replaces {{name}} placeholders; unknown names stay visible so they get noticed. */
export function fillPlaceholders(
  text: string,
  values: Record<string, string | null>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = text.replace(/\{\{\s*([a-zäöü]+)\s*\}\}/gi, (match, raw: string) => {
    const key = raw.toLowerCase();
    if (!(key in values)) return match;
    const value = values[key];
    if (!value) {
      missing.add(key);
      return "";
    }
    return value;
  });
  return { text: filled.replace(/[ \t]{2,}/g, " "), missing: [...missing] };
}

export const PLACEHOLDERS = ["firma", "ansprechpartner", "ort", "kurzlink", "absender"] as const;

export function composeLetter(input: LetterInput): ComposedLetter {
  const { sender, recipient } = input;
  const person = contactName(recipient.contact);
  const values: Record<string, string | null> = {
    firma: recipient.companyName,
    ansprechpartner: person,
    ort: recipient.city,
    kurzlink: input.shortLink,
    absender: sender.name ?? sender.company,
  };
  const subject = fillPlaceholders(input.subject, values);
  const body = fillPlaceholders(input.body.trim(), values);

  const place = [recipient.postalCode, recipient.city].filter(Boolean).join(" ");
  const address = [
    recipient.companyName,
    person,
    recipient.street,
    place || null,
    recipient.country !== "DE" ? (COUNTRY_NAMES[recipient.country] ?? recipient.country) : null,
  ].filter((line): line is string => Boolean(line));

  const senderPlace = [sender.postalCode, sender.city].filter(Boolean).join(" ");
  const returnAddress = [sender.company, sender.street, senderPlace].filter(Boolean).join(" · ");
  const senderContact = [
    sender.phone ? `Telefon ${sender.phone}` : null,
    sender.email,
    sender.website,
  ].filter((line): line is string => Boolean(line));

  return {
    returnAddress,
    address: address.slice(0, 6),
    date: new Intl.DateTimeFormat("de-DE", {
      timeZone: input.timeZone,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(input.date),
    subject: subject.text,
    salutation: OWN_SALUTATION.test(body.text) ? null : salutationFor(recipient.contact),
    body: body.text,
    closing: input.closing,
    senderName: sender.company,
    signer: { name: sender.name, role: sender.role, signatureUrl: input.signatureUrl },
    qr: { url: input.qrUrl, hint: input.qrHint, shortLink: input.shortLink },
    senderContact,
    footer: [
      [sender.company, sender.street, senderPlace].filter(Boolean).join(", "),
      senderContact.join(" · "),
    ].filter(Boolean),
    missing: [...new Set([...subject.missing, ...body.missing])],
  };
}

/** What is missing before letters can go out; empty when ready. */
export function letterProblems(input: {
  sender: LetterSender;
  recipient: Pick<LetterRecipient, "street" | "postalCode" | "city">;
}): string[] {
  const problems: string[] = [];
  if (!input.sender.street || !input.sender.city) {
    problems.push("Absenderadresse fehlt (Einstellungen → Absender).");
  }
  if (!input.recipient.street || !input.recipient.postalCode || !input.recipient.city) {
    problems.push("Anschrift des Kunden ist unvollständig.");
  }
  return problems;
}
