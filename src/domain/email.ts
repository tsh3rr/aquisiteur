/**
 * Outgoing mail to customers (§7.10, phase 7c-2): what happened to a message
 * after it left. Statuses come from the provider's webhooks, which may arrive
 * late or twice, so a status never steps back (`nextEmailStatus`). There are
 * no open pixels (§9): "delivered" is the furthest a mail gets.
 */

export const EMAIL_STATUSES = [
  "sending",
  "sent",
  "delayed",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatus, string> = {
  sending: "Wird gesendet",
  sent: "Versendet",
  delayed: "Verzögert",
  delivered: "Zugestellt",
  bounced: "Unzustellbar",
  complained: "Als Spam gemeldet",
  failed: "Fehlgeschlagen",
};

export const EMAIL_STATUS_TONES: Record<EmailStatus, "neutral" | "success" | "warning" | "danger"> =
  {
    sending: "neutral",
    sent: "neutral",
    delayed: "warning",
    delivered: "success",
    bounced: "danger",
    complained: "danger",
    failed: "danger",
  };

/** Statuses that need the owner: the customer did not get the mail. */
export const EMAIL_PROBLEMS: ReadonlySet<EmailStatus> = new Set([
  "bounced",
  "complained",
  "failed",
]);

const RANK: Record<EmailStatus, number> = {
  sending: 0,
  sent: 1,
  delayed: 2,
  delivered: 3,
  bounced: 4,
  complained: 4,
  failed: 4,
};

/** The status after an event, or null when it is old news; a problem is final. */
export function nextEmailStatus(current: EmailStatus, incoming: EmailStatus): EmailStatus | null {
  if (incoming === current || EMAIL_PROBLEMS.has(current)) return null;
  return RANK[incoming] >= RANK[current] ? incoming : null;
}

/** RFC 5322 Message-ID for a stored mail, so replies can be matched to it later. */
export function messageIdFor(emailId: string, domain: string): string {
  return `<${emailId}@${domain}>`;
}

/** Domain part of an address like `Name <user@example.com>`. */
export function domainOf(address: string): string | null {
  const match = /@([A-Za-z0-9.-]+\.[A-Za-z]{2,})>?\s*$/.exec(address.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * The sender as the customer sees it: the agency's name, the platform's
 * sending address (its own subdomain, so the owner's domain reputation is
 * never at stake). Quotes and angle brackets are stripped from the name.
 */
export function senderAddress(name: string, platformFrom: string): string {
  const address = /<([^>]+)>/.exec(platformFrom)?.[1] ?? platformFrom.trim();
  const clean = name.replace(/["<>\r\n]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}
