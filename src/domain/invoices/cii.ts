import type {
  InvoiceDocument,
  InvoiceIssuer,
  InvoiceKind,
  InvoiceParty,
  TaxTreatment,
} from "./schema";
import type { InvoiceTotals } from "./totals";

/**
 * The structured invoice inside the PDF (§7.10, phase 7c, ADR-0071):
 * UN/CEFACT Cross Industry Invoice in the EN 16931 profile, the format
 * ZUGFeRD 2 / Factur-X embed as `factur-x.xml`. Pure, so the business rules
 * (totals, tax categories, mandatory parties) are unit-tested.
 */

export const FACTURX_PROFILE = "urn:cen.eu:en16931:2017";
export const FACTURX_FILENAME = "factur-x.xml";

export interface EInvoiceInput {
  kind: InvoiceKind;
  number: string;
  issueDate: string;
  dueDate: string | null;
  document: InvoiceDocument;
  totals: InvoiceTotals;
  issuer: InvoiceIssuer;
  recipient: InvoiceParty;
  taxNote: string | null;
  /** For a cancellation: the number of the cancelled invoice. */
  cancels: string | null;
}

/** UNTDID 1001: commercial invoice, credit note (storno), prepayment invoice. */
const TYPE_CODE: Record<InvoiceKind, string> = {
  standard: "380",
  final: "380",
  deposit: "386",
  cancellation: "381",
};

/** UNTDID 5305 per treatment; domestic 0 % is zero-rated. */
function category(treatment: TaxTreatment, rate: number): string {
  switch (treatment) {
    case "small_business":
      return "E";
    case "reverse_charge":
      return "AE";
    case "non_taxable":
      return "O";
    case "domestic":
      return rate === 0 ? "Z" : "S";
  }
}

const EXEMPTION: Partial<Record<TaxTreatment, { code: string; text: string }>> = {
  reverse_charge: { code: "VATEX-EU-AE", text: "Reverse charge" },
  non_taxable: { code: "VATEX-EU-O", text: "Not subject to VAT" },
};

/** UN/ECE Rec 20 for the units the editor offers; anything else is „one“. */
const UNIT_CODES: Record<string, string> = {
  pauschal: "LS",
  stück: "H87",
  stk: "H87",
  stunde: "HUR",
  stunden: "HUR",
  std: "HUR",
  tag: "DAY",
  tage: "DAY",
  monat: "MON",
  monate: "MON",
  jahr: "ANN",
  seite: "C62",
};

export function unitCode(unit: string): string {
  return UNIT_CODES[unit.trim().toLowerCase()] ?? "C62";
}

/** BR-O-05/06: „not subject to VAT“ carries no rate at all. */
const rateElement = (cat: string, rate: number) =>
  cat === "O" ? "" : `<ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>`;

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cents as "1234.50"; a credit note carries positive amounts. */
function amount(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

const date = (iso: string) =>
  `<udt:DateTimeString format="102">${iso.replace(/-/g, "")}</udt:DateTimeString>`;

const el = (name: string, content: string | null | undefined) =>
  content === null || content === undefined || content === ""
    ? ""
    : `<ram:${name}>${content}</ram:${name}>`;

const text = (name: string, value: string | null | undefined) =>
  value ? el(name, escape(value)) : "";

function address(party: InvoiceParty): string {
  return el(
    "PostalTradeAddress",
    [
      text("PostcodeCode", party.postalCode),
      text("LineOne", party.street),
      text("CityName", party.city),
      el("CountryID", escape(party.country)),
    ].join(""),
  );
}

/**
 * Whether the seller can be told apart in the e-invoice (BR-CO-26, BR-E-02):
 * a UID, or for a small business the Steuernummer.
 */
export function eInvoiceGaps(input: { issuer: InvoiceIssuer; treatment: TaxTreatment }): string[] {
  const { issuer, treatment } = input;
  if (!issuer.vatId && !issuer.taxNumber) {
    return [
      "Für die E-Rechnung fehlt Ihre UID oder Steuernummer (Einstellungen → Angebote und Rechnungen).",
    ];
  }
  if (!issuer.vatId && (treatment === "domestic" || treatment === "reverse_charge")) {
    return ["Für die E-Rechnung mit Umsatzsteuer fehlt Ihre UID."];
  }
  return [];
}

export function facturXml(input: EInvoiceInput): string {
  const { document, totals, issuer, recipient, kind } = input;
  const sign = kind === "cancellation" ? -1 : 1;
  const money = (cents: number) => amount(sign * cents);
  const treatment = document.treatment;
  // BR-O-02: an invoice outside the scope of VAT names no VAT ids.
  const vatIds = treatment !== "non_taxable";

  const lines = totals.lines.map((line, index) => {
    const cat = category(treatment, line.vatRate);
    const rate = cat === "S" ? line.vatRate : 0;
    const allowance =
      line.lineDiscountCents !== 0
        ? `<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>${el("ActualAmount", money(line.lineDiscountCents))}${el("Reason", "Rabatt")}</ram:SpecifiedTradeAllowanceCharge>`
        : "";
    // The net price per unit times the quantity is the line before its discount.
    const netPrice = sign * line.unitPriceCents;
    return [
      "<ram:IncludedSupplyChainTradeLineItem>",
      el("AssociatedDocumentLineDocument", el("LineID", String(index + 1))),
      el("SpecifiedTradeProduct", text("Name", line.title) + text("Description", line.description)),
      el(
        "SpecifiedLineTradeAgreement",
        el("NetPriceProductTradePrice", el("ChargeAmount", amount(netPrice))),
      ),
      el(
        "SpecifiedLineTradeDelivery",
        `<ram:BilledQuantity unitCode="${unitCode(line.unit)}">${String(line.quantity)}</ram:BilledQuantity>`,
      ),
      el(
        "SpecifiedLineTradeSettlement",
        el(
          "ApplicableTradeTax",
          el("TypeCode", "VAT") + el("CategoryCode", cat) + rateElement(cat, rate),
        ) +
          allowance +
          el(
            "SpecifiedTradeSettlementLineMonetarySummation",
            el("LineTotalAmount", money(line.netCents)),
          ),
      ),
      "</ram:IncludedSupplyChainTradeLineItem>",
    ].join("");
  });

  // One breakdown per category and rate (BR-CO-18): without VAT, all rates fold into one.
  const groups = new Map<
    string,
    { cat: string; rate: number; lines: number; base: number; vat: number }
  >();
  const group = (vatRate: number) => {
    const cat = category(treatment, vatRate);
    const rate = cat === "S" ? vatRate : 0;
    const key = `${cat}|${rate}`;
    if (!groups.has(key)) groups.set(key, { cat, rate, lines: 0, base: 0, vat: 0 });
    return groups.get(key)!;
  };
  for (const line of totals.lines) group(line.vatRate).lines += line.netCents;
  for (const entry of totals.vat) {
    const target = group(entry.rate);
    target.base += entry.baseCents;
    target.vat += entry.vatCents;
  }
  const exemption =
    treatment === "small_business"
      ? { code: null, text: input.taxNote ?? "Kleinunternehmer" }
      : (EXEMPTION[treatment] ?? null);
  const taxElements = (entry: { cat: string; rate: number }) =>
    el("TypeCode", "VAT") + el("CategoryCode", entry.cat) + rateElement(entry.cat, entry.rate);
  const vatBreakdown = [...groups.values()].map((entry) =>
    el(
      "ApplicableTradeTax",
      [
        el("CalculatedAmount", money(entry.vat)),
        el("TypeCode", "VAT"),
        exemption && entry.cat !== "S" && entry.cat !== "Z"
          ? text("ExemptionReason", exemption.text)
          : "",
        el("BasisAmount", money(entry.base)),
        el("CategoryCode", entry.cat),
        exemption?.code && entry.cat !== "S" && entry.cat !== "Z"
          ? el("ExemptionReasonCode", exemption.code)
          : "",
        rateElement(entry.cat, entry.rate),
      ].join(""),
    ),
  );
  // The overall discount, per category and rate as the totals compute it.
  const headerAllowances = [...groups.values()]
    .map((entry) => {
      const allowance = entry.lines - entry.base;
      if (allowance === 0) return "";
      return el(
        "SpecifiedTradeAllowanceCharge",
        `<ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>` +
          el("ActualAmount", money(allowance)) +
          el("Reason", "Gesamtrabatt") +
          el("CategoryTradeTax", taxElements(entry)),
      );
    })
    .join("");

  const period = document.servicePeriod;
  const terms = [
    document.paymentTermsDays > 0 && kind !== "cancellation"
      ? text("Description", `Zahlbar innerhalb von ${document.paymentTermsDays} Tagen.`)
      : text("Description", "Sofort fällig."),
    input.dueDate && kind !== "cancellation" ? el("DueDateDateTime", date(input.dueDate)) : "",
  ].join("");

  const seller = [
    // BT-29 when no VAT id goes into the XML (BR-CO-26): the Steuernummer, else the UID as plain id.
    !(issuer.vatId && vatIds) ? text("ID", issuer.taxNumber ?? issuer.vatId) : "",
    text("Name", issuer.name),
    address(issuer),
    issuer.email
      ? el(
          "URIUniversalCommunication",
          `<ram:URIID schemeID="EM">${escape(issuer.email)}</ram:URIID>`,
        )
      : "",
    issuer.vatId && vatIds
      ? el("SpecifiedTaxRegistration", `<ram:ID schemeID="VA">${escape(issuer.vatId)}</ram:ID>`)
      : "",
    issuer.taxNumber
      ? el("SpecifiedTaxRegistration", `<ram:ID schemeID="FC">${escape(issuer.taxNumber)}</ram:ID>`)
      : "",
  ].join("");
  const buyer = [
    text("Name", recipient.name),
    address(recipient),
    recipient.vatId && vatIds
      ? el("SpecifiedTaxRegistration", `<ram:ID schemeID="VA">${escape(recipient.vatId)}</ram:ID>`)
      : "",
  ].join("");

  const prepaid = totals.deductedCents;
  const notes = [input.taxNote, document.intro]
    .filter((note): note is string => Boolean(note))
    .map((note) => el("IncludedNote", text("Content", note)))
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
    "<rsm:ExchangedDocumentContext>",
    el("GuidelineSpecifiedDocumentContextParameter", el("ID", FACTURX_PROFILE)),
    "</rsm:ExchangedDocumentContext>",
    "<rsm:ExchangedDocument>",
    text("ID", input.number),
    el("TypeCode", TYPE_CODE[kind]),
    el("IssueDateTime", date(input.issueDate)),
    notes,
    "</rsm:ExchangedDocument>",
    "<rsm:SupplyChainTradeTransaction>",
    lines.join(""),
    el(
      "ApplicableHeaderTradeAgreement",
      el("SellerTradeParty", seller) + el("BuyerTradeParty", buyer),
    ),
    el(
      "ApplicableHeaderTradeDelivery",
      period
        ? el(
            "ActualDeliverySupplyChainEvent",
            el("OccurrenceDateTime", date(period.to ?? period.from)),
          )
        : "",
    ),
    el(
      "ApplicableHeaderTradeSettlement",
      [
        text("PaymentReference", input.number),
        el("InvoiceCurrencyCode", "EUR"),
        issuer.iban && kind !== "cancellation"
          ? el(
              "SpecifiedTradeSettlementPaymentMeans",
              el("TypeCode", "58") +
                el(
                  "PayeePartyCreditorFinancialAccount",
                  text("IBANID", issuer.iban) + text("AccountName", issuer.name),
                ),
            )
          : "",
        vatBreakdown.join(""),
        period?.to
          ? el(
              "BillingSpecifiedPeriod",
              el("StartDateTime", date(period.from)) + el("EndDateTime", date(period.to)),
            )
          : "",
        headerAllowances,
        el("SpecifiedTradePaymentTerms", terms),
        el(
          "SpecifiedTradeSettlementHeaderMonetarySummation",
          [
            el("LineTotalAmount", money(totals.linesCents)),
            el("AllowanceTotalAmount", money(totals.discountCents)),
            el("TaxBasisTotalAmount", money(totals.netCents)),
            `<ram:TaxTotalAmount currencyID="EUR">${money(totals.vatCents)}</ram:TaxTotalAmount>`,
            el("GrandTotalAmount", money(totals.totalCents)),
            prepaid !== 0 ? el("TotalPrepaidAmount", money(prepaid)) : "",
            el("DuePayableAmount", money(totals.dueCents)),
          ].join(""),
        ),
        input.cancels
          ? el("InvoiceReferencedDocument", text("IssuerAssignedID", input.cancels))
          : "",
      ].join(""),
    ),
    "</rsm:SupplyChainTradeTransaction>",
    "</rsm:CrossIndustryInvoice>",
  ].join("\n");
}
