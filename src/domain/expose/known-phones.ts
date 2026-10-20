/**
 * Prefilled callback numbers (§7.4 „Rückruf-Formular vorausfüllen“). An
 * exposé link can be forwarded, so the page only ever sees a masked number
 * and an opaque reference; the full number stays on the server and is looked
 * up again when the form comes back.
 */

/** A number the callback form may offer: what to show and how to refer to it. */
export interface KnownPhone {
  /** "p" for the prospect's own number, otherwise the contact's id. */
  ref: string;
  masked: string;
}

export const knownPhoneRef = /^(p|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Most callback forms need one number; a short list keeps the choice easy. */
const MAX_OFFERED = 3;
/** Shorter numbers would leave too few digits hidden. */
const MIN_DIGITS = 8;

/** Digits with an optional leading "+", or null when it is no usable number. */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\+?[0-9 ()/.-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS) return null;
  const international = trimmed.startsWith("+") || digits.startsWith("00");
  return international ? `+${digits.replace(/^00/, "")}` : digits;
}

/**
 * „+49 170 ••• 67“ or „0170 ••• 67“: country code and the start of the area
 * or mobile prefix stay readable so a person recognises their number, the
 * middle is hidden, and only the last two digits are shown.
 */
export function maskPhone(raw: string): string | null {
  const phone = normalizePhone(raw);
  if (!phone) return null;
  const tail = phone.slice(-2);
  if (phone.startsWith("+")) {
    const digits = phone.slice(1);
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ••• ${tail}`;
  }
  return `${phone.slice(0, 4)} ••• ${tail}`;
}

/**
 * The numbers to offer, prospect first, then its contacts in the given
 * order. Duplicates (same digits, also across +49 and 0 notation) are
 * offered once.
 */
export function knownPhones(sources: { ref: string; phone: string | null }[]): KnownPhone[] {
  const seen = new Set<string>();
  const result: KnownPhone[] = [];
  for (const source of sources) {
    if (!source.phone || !knownPhoneRef.test(source.ref)) continue;
    const phone = normalizePhone(source.phone);
    const masked = maskPhone(source.phone);
    if (!phone || !masked) continue;
    const key = phone.replace(/^\+49/, "0");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ref: source.ref, masked });
    if (result.length === MAX_OFFERED) break;
  }
  return result;
}
