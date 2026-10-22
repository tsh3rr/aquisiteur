import { describe, expect, it } from "vitest";
import { eInvoiceGaps, facturXml, unitCode, type EInvoiceInput } from "./cii";
import { invoiceDocumentSchema, type InvoiceIssuer, type InvoiceKind } from "./schema";
import { invoiceTotals } from "./totals";

/** Checked against the EN 16931 / Factur-X schematron with Mustang (ADR-0071). */

const issuer: InvoiceIssuer = {
  name: "Studio Kapek",
  street: "Hauptstraße 1",
  postalCode: "1010",
  city: "Wien",
  country: "AT",
  vatId: "ATU12345678",
  taxNumber: "12 345/6789",
  email: "office@kapek.test",
  iban: "AT611904300234573201",
  bic: null,
  bankName: null,
};
const recipient = {
  name: "Bäckerei Huber & Söhne",
  street: "Gasse 2",
  postalCode: "8010",
  city: "Graz",
  country: "AT",
  vatId: null,
};

function xml(
  treatment: string,
  kind: InvoiceKind = "standard",
  extra: Partial<EInvoiceInput> = {},
  doc: Record<string, unknown> = {},
) {
  const document = invoiceDocumentSchema.parse({
    treatment,
    discountPercent: 10,
    servicePeriod: { from: "2026-10-01", to: "2026-10-31" },
    lines: [
      { id: "web", title: "Website", unitPriceCents: 300_000, vatRate: 20 },
      {
        id: "text",
        title: "Texte",
        quantity: 2.5,
        unit: "Stunde",
        unitPriceCents: 8_000,
        vatRate: 13,
      },
    ],
    ...doc,
  });
  return facturXml({
    kind,
    number: "RE-2026-0002",
    issueDate: "2026-10-22",
    dueDate: "2026-11-05",
    document,
    totals: invoiceTotals(document, kind),
    issuer,
    recipient,
    taxNote: null,
    cancels: null,
    ...extra,
  });
}

const tag = (source: string, name: string) =>
  [...source.matchAll(new RegExp(`<ram:${name}>([^<]*)</ram:${name}>`, "g"))].map((m) => m[1]);

describe("facturXml", () => {
  it("writes the EN 16931 profile, number, dates and escaped names", () => {
    const out = xml("domestic");
    expect(out).toContain("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>");
    expect(out).toContain('<udt:DateTimeString format="102">20261022</udt:DateTimeString>');
    expect(out).toContain("<ram:Name>Bäckerei Huber &amp; Söhne</ram:Name>");
    expect(tag(out, "TypeCode")[0]).toBe("380");
    expect(out).toContain('<ram:BilledQuantity unitCode="HUR">2.5</ram:BilledQuantity>');
  });

  it("splits VAT per rate with the overall discount as document allowances", () => {
    const out = xml("domestic");
    expect(tag(out, "BasisAmount")).toEqual(["2700.00", "180.00"]);
    expect(tag(out, "CalculatedAmount")).toEqual(["540.00", "23.40"]);
    expect(tag(out, "LineTotalAmount")).toEqual(["3000.00", "200.00", "3200.00"]);
    expect(tag(out, "AllowanceTotalAmount")).toEqual(["320.00"]);
    expect(tag(out, "GrandTotalAmount")).toEqual(["3443.40"]);
  });

  it("folds all rates into one exempt category for a small business", () => {
    const out = xml("small_business", "standard", {
      taxNote: "Der Rechnungsbetrag enthält gemäß § 6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer.",
    });
    expect(out.match(/<ram:CategoryCode>E<\/ram:CategoryCode>/g)).toHaveLength(2 + 1 + 1);
    expect(tag(out, "ExemptionReason")).toEqual([expect.stringContaining("§ 6 Abs. 1 Z 27")]);
    expect(tag(out, "TaxTotalAmount")).toEqual([]);
    expect(out).toContain('<ram:TaxTotalAmount currencyID="EUR">0.00</ram:TaxTotalAmount>');
  });

  it("marks reverse charge and names no VAT ids or rates when out of scope", () => {
    expect(xml("reverse_charge")).toContain(
      "<ram:ExemptionReasonCode>VATEX-EU-AE</ram:ExemptionReasonCode>",
    );
    const outOfScope = xml("non_taxable");
    expect(outOfScope).not.toContain('schemeID="VA"');
    expect(outOfScope).not.toContain("<ram:RateApplicablePercent>");
    expect(outOfScope).toContain("<ram:ID>12 345/6789</ram:ID>");
  });

  it("states deposits as prepaid, a deposit as prepayment invoice", () => {
    const final = xml(
      "domestic",
      "final",
      {},
      {
        deductions: [
          {
            invoiceId: "00000000-0000-4000-8000-000000000001",
            number: "RE-2026-0001",
            issueDate: "2026-09-01",
            byRate: [{ rate: 20, netCents: 100_000, vatCents: 20_000 }],
          },
        ],
      },
    );
    expect(tag(final, "TotalPrepaidAmount")).toEqual(["1200.00"]);
    expect(tag(final, "DuePayableAmount")).toEqual(["2243.40"]);
    expect(tag(xml("domestic", "deposit"), "TypeCode")[0]).toBe("386");
  });

  it("writes a storno as credit note with positive amounts and the reference", () => {
    const out = xml("domestic", "cancellation", { cancels: "RE-2026-0001" });
    expect(tag(out, "TypeCode")[0]).toBe("381");
    expect(tag(out, "GrandTotalAmount")).toEqual(["3443.40"]);
    expect(out).not.toMatch(/>-\d/);
    expect(out).toContain("<ram:IssuerAssignedID>RE-2026-0001</ram:IssuerAssignedID>");
    expect(out).not.toContain("<ram:IBANID>");
  });

  it("maps units and reports what the e-invoice misses", () => {
    expect([unitCode("Pauschal"), unitCode("Monat"), unitCode("Seiten")]).toEqual([
      "LS",
      "MON",
      "C62",
    ]);
    const bare = { ...issuer, vatId: null, taxNumber: null };
    expect(eInvoiceGaps({ issuer: bare, treatment: "small_business" })).toHaveLength(1);
    expect(
      eInvoiceGaps({ issuer: { ...bare, taxNumber: "1" }, treatment: "small_business" }),
    ).toEqual([]);
    expect(
      eInvoiceGaps({ issuer: { ...bare, taxNumber: "1" }, treatment: "domestic" }),
    ).toHaveLength(1);
  });
});
