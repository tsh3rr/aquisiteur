/**
 * Bank details and the EPC QR code („Zahlen mit Code“, EPC069-12 v2) on the
 * invoice PDF (§7.10). Austrian and German banking apps read it.
 */

/** Normalises an IBAN ("AT61 1904 …" → "AT611904…") and checks it with mod 97. */
export function normaliseIban(raw: string): string | null {
  const iban = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const char of rearranged) {
    const value = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1 ? iban : null;
}

/** "AT61 1904 3002 3457 3201": groups of four for print. */
export function formatIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * The text encoded in the QR code. Returns null when the amount is outside
 * what the standard allows (0,01 € to 999.999.999,99 €).
 */
export function epcPayload(input: {
  name: string;
  iban: string;
  bic?: string | null;
  amountCents: number;
  reference: string;
}): string | null {
  if (input.amountCents < 1 || input.amountCents > 99_999_999_999) return null;
  const amount = `EUR${Math.floor(input.amountCents / 100)}.${String(input.amountCents % 100).padStart(2, "0")}`;
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    input.bic ?? "",
    input.name.slice(0, 70),
    input.iban,
    amount,
    "",
    "",
    input.reference.slice(0, 140),
  ].join("\n");
}
