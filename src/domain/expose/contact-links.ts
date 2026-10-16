import type { ChannelSettings } from "@/domain/workspace-settings";
import type { CONTACT_CHANNELS } from "./schema";

/**
 * Contact links of the exposé (§7.4). Every prefilled text carries the
 * reference code, so the owner can match an incoming WhatsApp message or
 * e-mail to the prospect ("… [Ref K7M2]").
 */
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

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

/** Channels that are plain links; `chat` and `callback` open UI in the exposé. */
export type LinkChannel = Exclude<ContactChannel, "chat" | "callback">;

export interface ContactLink {
  channel: LinkChannel;
  href: string;
  /** Human-readable target, e.g. the formatted phone number. */
  display: string;
  /** Opens in a new tab (WhatsApp, Messenger, booking page). */
  external: boolean;
}

type LinkSettings = Pick<
  ChannelSettings,
  "email" | "phone" | "mobile" | "whatsapp" | "messengerPage" | "sms" | "bookingUrl"
>;

export function whatsappHref(settings: LinkSettings, text: string): string | null {
  const number = settings.whatsapp ?? settings.mobile;
  const digits = number ? whatsappNumber(number) : null;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

function linkFor(
  channel: LinkChannel,
  settings: LinkSettings,
  text: string,
  company: string,
  refCode: string,
): ContactLink | null {
  switch (channel) {
    case "whatsapp": {
      const href = whatsappHref(settings, text);
      const display = settings.whatsapp ?? settings.mobile;
      return href && display ? { channel, href, display, external: true } : null;
    }
    case "phone": {
      const number = settings.phone ?? settings.mobile;
      return number ? { channel, href: telHref(number), display: number, external: false } : null;
    }
    case "email": {
      if (!settings.email) return null;
      const subject = `Ihre Vorschläge für ${company} [Ref ${refCode}]`;
      return {
        channel,
        href: `mailto:${settings.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n`)}`,
        display: settings.email,
        external: false,
      };
    }
    case "booking": {
      if (!settings.bookingUrl) return null;
      return {
        channel,
        href: settings.bookingUrl,
        display: new URL(settings.bookingUrl).host,
        external: true,
      };
    }
    case "messenger": {
      if (!settings.messengerPage) return null;
      return {
        channel,
        href: `https://m.me/${encodeURIComponent(settings.messengerPage)}?ref=${encodeURIComponent(refCode)}`,
        display: "Facebook Messenger",
        external: true,
      };
    }
    case "sms": {
      const number = settings.sms ?? settings.mobile;
      if (!number) return null;
      // `?&body=` is understood by both iOS and Android.
      const target = telHref(number).slice("tel:".length);
      return {
        channel,
        href: `sms:${target}?&body=${encodeURIComponent(text)}`,
        display: number,
        external: false,
      };
    }
  }
}

/** Links for the configured channels, in the exposé's order; unconfigured ones are left out. */
export function contactLinks(input: {
  channels: readonly ContactChannel[];
  settings: LinkSettings;
  message: string | undefined;
  company: string;
  refCode: string;
}): ContactLink[] {
  const text = prefilledMessage(input.message, input.company, input.refCode);
  return input.channels.flatMap((channel) => {
    if (channel === "chat" || channel === "callback") return [];
    const link = linkFor(channel, input.settings, text, input.company, input.refCode);
    return link ? [link] : [];
  });
}
