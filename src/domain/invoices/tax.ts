import type { TaxMode } from "../billing";
import type { InvoiceKind, InvoiceIssuer, InvoiceParty, TaxTreatment } from "./schema";
import type { InvoiceTotals } from "./totals";

/**
 * Austrian invoice rules (§7.10, ADR-0070). Researched, not tax advice: the
 * owner checks them with the tax adviser before the first real invoice.
 */

/** EU member states by ISO code (Greece is GR here, EL in VAT ids). */
export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]); // prettier-ignore

/** § 11 Abs. 6 UStG: up to 400 € gross a simplified invoice is enough. */
export const SMALL_AMOUNT_CENTS = 40_000;
/** § 11 Abs. 1 Z 3 lit. i UStG: above 10.000 € gross the recipient's UID is required. */
export const RECIPIENT_VAT_ID_CENTS = 1_000_000;
/** § 6 Abs. 1 Z 27 UStG (from 2025): 55.000 € gross per year, 10 % tolerance once. */
export const SMALL_BUSINESS_LIMIT_CENTS = 5_500_000;
export const SMALL_BUSINESS_TOLERANCE_CENTS = 6_050_000;

export interface TreatmentInput {
  taxMode: TaxMode;
  country: string;
  customerType: "business" | "consumer";
  vatId: string | null | undefined;
}

/** Default treatment for a customer; the invoice may override it. */
export function defaultTreatment(input: TreatmentInput): TaxTreatment {
  const home: TaxTreatment = input.taxMode === "small_business" ? "small_business" : "domestic";
  const country = input.country.toUpperCase();
  if (country === "AT") return home;
  if (EU_COUNTRIES.has(country)) {
    return input.customerType === "business" && input.vatId ? "reverse_charge" : home;
  }
  return input.customerType === "business" ? "non_taxable" : home;
}

/**
 * Cases the rules here do not settle, flagged for the tax adviser: private
 * customers abroad (place of supply for electronic services, OSS) and a
 * business in the EU without a UID.
 */
export function needsReview(input: TreatmentInput): string | null {
  const country = input.country.toUpperCase();
  if (country === "AT") return null;
  if (input.customerType === "consumer") {
    return "Privatkunde im Ausland: Leistungsort und OSS bitte mit dem Steuerberater klären.";
  }
  if (EU_COUNTRIES.has(country) && !input.vatId) {
    return "EU-Unternehmen ohne UID: ohne UID kein Reverse Charge, bitte die UID erfragen.";
  }
  return null;
}

export const REVERSE_CHARGE_NOTE =
  "Übergang der Steuerschuld auf den Leistungsempfänger (Reverse Charge).";
export const NON_TAXABLE_NOTE =
  "Nicht im Inland steuerbare Leistung; Leistungsort beim Empfänger (§ 3a Abs. 6 UStG 1994).";

/** The tax line on the invoice; null when VAT is shown and needs no words. */
export function treatmentNote(
  treatment: TaxTreatment,
  smallBusinessNote: string,
  override?: string,
): string | null {
  if (override) return override;
  switch (treatment) {
    case "small_business":
      return smallBusinessNote;
    case "reverse_charge":
      return REVERSE_CHARGE_NOTE;
    case "non_taxable":
      return NON_TAXABLE_NOTE;
    case "domestic":
      return null;
  }
}

export interface IssueIssue {
  path?: string;
  message: string;
  /** Errors block issuing; warnings are shown and may be ignored. */
  level: "error" | "warning";
}

export interface IssueCheckInput {
  kind: InvoiceKind;
  treatment: TaxTreatment;
  totals: InvoiceTotals;
  hasLines: boolean;
  hasServicePeriod: boolean;
  issuer: InvoiceIssuer;
  recipient: InvoiceParty;
  customerType: "business" | "consumer";
  review: string | null;
}

function hasAddress(party: InvoiceParty): boolean {
  return Boolean(party.name && party.street && party.postalCode && party.city);
}

/**
 * The mandatory contents of § 11 UStG by amount, checked before issuing.
 * The number, date and amounts the app fills itself; this checks what the
 * owner has to supply.
 */
export function issueIssues(input: IssueCheckInput): IssueIssue[] {
  const issues: IssueIssue[] = [];
  const error = (message: string, path?: string) => issues.push({ message, path, level: "error" });
  const warning = (message: string, path?: string) =>
    issues.push({ message, path, level: "warning" });
  const gross = Math.abs(input.totals.totalCents);

  if (!input.hasLines) error("Die Rechnung braucht mindestens eine Position.", "lines");
  if (input.kind !== "cancellation") {
    if (input.totals.totalCents <= 0) error("Der Rechnungsbetrag muss größer als 0 sein.");
    if (input.totals.dueCents < 0) {
      error("Die abgezogenen Anzahlungen sind höher als der Rechnungsbetrag.");
    }
  }
  if (!input.hasServicePeriod) {
    error("Bitte Leistungsdatum oder Leistungszeitraum angeben.", "servicePeriod");
  }
  if (!hasAddress(input.issuer)) {
    error("Ihr Name und Ihre Anschrift fehlen (Einstellungen → Briefe → Absender).", "issuer");
  }
  if (gross > SMALL_AMOUNT_CENTS && !hasAddress(input.recipient)) {
    error("Über 400 € brutto braucht die Rechnung Name und Anschrift des Kunden.", "recipient");
  }
  const vatShown = input.treatment === "domestic" || input.treatment === "reverse_charge";
  if (vatShown && gross > SMALL_AMOUNT_CENTS && !input.issuer.vatId) {
    error("Ihre UID fehlt (Einstellungen → Angebote und Rechnungen).", "issuer.vatId");
  }
  if (
    input.treatment === "domestic" &&
    gross > RECIPIENT_VAT_ID_CENTS &&
    input.customerType === "business" &&
    !input.recipient.vatId
  ) {
    error("Über 10.000 € brutto braucht die Rechnung die UID des Kunden.", "recipient.vatId");
  }
  if (input.treatment === "reverse_charge") {
    if (!input.recipient.vatId)
      error("Reverse Charge braucht die UID des Kunden.", "recipient.vatId");
    if (!input.issuer.vatId) error("Reverse Charge braucht Ihre eigene UID.", "issuer.vatId");
    if (input.recipient.country === "AT" || !EU_COUNTRIES.has(input.recipient.country)) {
      error("Reverse Charge gilt nur für Unternehmen in einem anderen EU-Land.", "treatment");
    }
  }
  if (!input.issuer.iban) {
    warning("Ohne IBAN fehlen Bankverbindung und QR-Code zum Bezahlen.", "issuer.iban");
  }
  if (input.review) warning(input.review, "treatment");
  return issues;
}

export type GuardLevel = "ok" | "warning" | "tolerance" | "exceeded";

/** The small-business limit for the year so far (§ 6 Abs. 1 Z 27 UStG). */
export function smallBusinessGuard(revenueGrossCents: number): {
  level: GuardLevel;
  percent: number;
  message: string | null;
} {
  const percent = Math.round((revenueGrossCents / SMALL_BUSINESS_LIMIT_CENTS) * 100);
  if (revenueGrossCents > SMALL_BUSINESS_TOLERANCE_CENTS) {
    return {
      level: "exceeded",
      percent,
      message:
        "Die Toleranz von 60.500 € ist überschritten: Ab dem Umsatz, der sie überschreitet, entfällt die Befreiung. Stellen Sie auf Regelbesteuerung um und sprechen Sie mit Ihrem Steuerberater.",
    };
  }
  if (revenueGrossCents > SMALL_BUSINESS_LIMIT_CENTS) {
    return {
      level: "tolerance",
      percent,
      message:
        "55.000 € sind überschritten, aber innerhalb der Toleranz von 10 %: Die Befreiung gilt bis Jahresende, im nächsten Jahr nicht mehr.",
    };
  }
  if (revenueGrossCents >= SMALL_BUSINESS_LIMIT_CENTS * 0.8) {
    return {
      level: "warning",
      percent,
      message: `${percent} % der Kleinunternehmergrenze von 55.000 € sind erreicht.`,
    };
  }
  return { level: "ok", percent, message: null };
}
