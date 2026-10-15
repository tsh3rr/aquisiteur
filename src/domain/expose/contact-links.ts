import type { ChannelSettings } from "@/domain/workspace-settings";
import type { CONTACT_CHANNELS } from "./schema";

/**
 * Contact links of the exposé (§7.4). Every prefilled text carries the
 * reference code, so the owner can match an incoming WhatsApp message or
 * e-mail to the prospect ("… [Ref K7M2]").
 */
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export interface ContactLink {
  channel: ContactChannel;
  href: string;
  /** Human-readable target, e.g. the formatted phone number. */
  display: string;
}

/** wa.me wants digits with country code and no leading zeros or plus. */
export function whatsappNumber(raw: string, defaultCountryCode = "49"): string | null {
  const trimmed = raw.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    digits = defaultCountryCode + digits.slice(1);
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function telHref(raw: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  return `tel:${cleaned}`;
}

export function prefilledMessage(message: string | undefined, company: string, ref: string) {
  const base = message ?? `Hallo, ich habe Ihre Vorschläge für ${company} gesehen.`;
  return `${base} [Ref ${ref}]`;
}

export function contactLinks(input: {
  channels: readonly ContactChannel[];
  settings: Pick<ChannelSettings, "email" | "phone" | "mobile" | "whatsapp">;
  message: string | undefined;
  company: string;
  refCode: string;
}): ContactLink[] {
  const text = prefilledMessage(input.message, input.company, input.refCode);
  const links: ContactLink[] = [];
  for (const channel of input.channels) {
    if (channel === "whatsapp") {
      const number = input.settings.whatsapp ?? input.settings.mobile;
      const digits = number ? whatsappNumber(number) : null;
      if (number && digits) {
        links.push({
          channel,
          href: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
          display: number,
        });
      }
    } else if (channel === "phone") {
      const number = input.settings.phone ?? input.settings.mobile;
      if (number) links.push({ channel, href: telHref(number), display: number });
    } else if (channel === "email" && input.settings.email) {
      const subject = `Ihre Vorschläge für ${input.company} [Ref ${input.refCode}]`;
      links.push({
        channel,
        href: `mailto:${input.settings.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n`)}`,
        display: input.settings.email,
      });
    }
  }
  return links;
}
