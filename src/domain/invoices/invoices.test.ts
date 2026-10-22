import { describe, expect, it } from "vitest";
import { invoicesCsv, type CsvInvoice } from "./csv";
import { epcPayload, formatIban, normaliseIban } from "./epc";
import { billingProfileSchema, invoiceDocumentSchema, type InvoiceIssuer } from "./schema";
import {
  defaultTreatment,
  issueIssues,
  needsReview,
  smallBusinessGuard,
  treatmentNote,
  type IssueCheckInput,
} from "./tax";
import { depositLines, invoiceTotals, paymentState, servicePeriodLabel } from "./totals";

const doc = (input: Record<string, unknown>) => invoiceDocumentSchema.parse(input);

const line = (id: string, unitPriceCents: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  unitPriceCents,
  ...extra,
});

describe("invoiceTotals", () => {
  it("adds VAT per rate on the discounted sum", () => {
    const totals = invoiceTotals(
      doc({
        treatment: "domestic",
        discountPercent: 10,
        lines: [
          line("web", 100_000, { quantity: 2 }),
          line("text", 33_333, { vatRate: 13, discountPercent: 50 }),
        ],
      }),
    );
    // 333,33 € at 50 %: the discount rounds half up to 166,67 €.
    expect(totals.linesCents).toBe(200_000 + 16_666);
    expect(totals.vat).toEqual([
      { rate: 20, baseCents: 180_000, vatCents: 36_000 },
      { rate: 13, baseCents: 14_999, vatCents: 1_950 },
    ]);
    expect(totals.netCents).toBe(194_999);
    expect(totals.discountCents).toBe(21_667);
    expect(totals.totalCents).toBe(232_949);
    expect(totals.dueCents).toBe(232_949);
  });

  it("shows no VAT for small business, reverse charge and non-taxable", () => {
    for (const treatment of ["small_business", "reverse_charge", "non_taxable"]) {
      const totals = invoiceTotals(doc({ treatment, lines: [line("ab", 50_000)] }));
      expect(totals.vatCents, treatment).toBe(0);
      expect(totals.totalCents, treatment).toBe(50_000);
    }
  });

  it("subtracts deposits on a final invoice", () => {
    const totals = invoiceTotals(
      doc({
        treatment: "domestic",
        lines: [line("web", 300_000)],
        deductions: [
          {
            invoiceId: "00000000-0000-4000-8000-000000000001",
            number: "RE-2026-0001",
            issueDate: "2026-09-01",
            byRate: [{ rate: 20, netCents: 150_000, vatCents: 30_000 }],
          },
        ],
      }),
      "final",
    );
    expect(totals.totalCents).toBe(360_000);
    expect(totals.deductedNetCents).toBe(150_000);
    expect(totals.deductedVatCents).toBe(30_000);
    expect(totals.dueCents).toBe(180_000);
  });

  it("negates every amount on a cancellation", () => {
    const original = doc({ treatment: "domestic", lines: [line("web", 10_000)] });
    const totals = invoiceTotals(original, "cancellation");
    expect(totals.totalCents).toBe(-12_000);
    expect(totals.vatCents).toBe(-2_000);
    expect(totals.lines[0]!.netCents).toBe(-10_000);
    expect(totals.lines[0]!.unitPriceCents).toBe(-10_000);
  });
});

describe("depositLines", () => {
  it("keeps the rate split and gives the rounding rest to the last rate", () => {
    const lines = depositLines(
      [
        { rate: 20, baseCents: 100_001 },
        { rate: 13, baseCents: 50_000 },
      ],
      180_001,
      60_000,
      "Anzahlung",
    );
    expect(lines.map((l) => [l.vatRate, l.title])).toEqual([
      [20, "Anzahlung (20 % USt)"],
      [13, "Anzahlung (13 % USt)"],
    ]);
    const net = lines.reduce((sum, l) => sum + l.unitPriceCents, 0);
    expect(net).toBe(Math.round(150_001 * (60_000 / 180_001)));
  });

  it("returns nothing for an empty offer", () => {
    expect(depositLines([], 0, 100, "Anzahlung")).toEqual([]);
  });
});

describe("paymentState", () => {
  const issued = { status: "issued" as const, dueDate: "2026-10-15", dueCents: 10_000 };
  it("distinguishes open, partly paid, paid and overdue", () => {
    expect(paymentState(issued, 0, "2026-10-10")).toBe("open");
    expect(paymentState(issued, 5_000, "2026-10-10")).toBe("partly_paid");
    expect(paymentState(issued, 10_000, "2026-10-20")).toBe("paid");
    expect(paymentState(issued, 5_000, "2026-10-16")).toBe("overdue");
    expect(paymentState({ ...issued, status: "cancelled" }, 0, "2026-10-16")).toBe("cancelled");
    expect(paymentState({ ...issued, status: "draft" }, 0, "2026-10-16")).toBe("draft");
    expect(
      paymentState({ ...issued, kind: "cancellation", dueCents: -10_000 }, 0, "2026-11-01"),
    ).toBe("storno");
  });
});

it("prints a service date or period", () => {
  expect(servicePeriodLabel({ from: "2026-10-01" })).toBe("01.10.2026");
  expect(servicePeriodLabel({ from: "2026-10-01", to: "2026-10-31" })).toBe(
    "01.10.2026 – 31.10.2026",
  );
  expect(servicePeriodLabel(undefined)).toBe("–");
});

describe("billingProfileSchema", () => {
  it("normalises the VAT id and empties blank fields", () => {
    expect(billingProfileSchema.parse({ vatId: "atu 1234.5678", email: "", city: " " })).toEqual({
      customerType: "business",
      vatId: "ATU12345678",
      email: undefined,
      city: undefined,
      name: undefined,
      street: undefined,
      postalCode: undefined,
      country: undefined,
    });
    expect(billingProfileSchema.safeParse({ vatId: "123" }).success).toBe(false);
  });
});

describe("tax treatment", () => {
  const base = { taxMode: "standard" as const, customerType: "business" as const, vatId: null };
  it("picks the treatment from country, customer type and UID", () => {
    expect(defaultTreatment({ ...base, country: "AT" })).toBe("domestic");
    expect(defaultTreatment({ ...base, taxMode: "small_business", country: "AT" })).toBe(
      "small_business",
    );
    expect(defaultTreatment({ ...base, country: "DE", vatId: "DE123456789" })).toBe(
      "reverse_charge",
    );
    expect(defaultTreatment({ ...base, country: "DE" })).toBe("domestic");
    expect(defaultTreatment({ ...base, country: "CH" })).toBe("non_taxable");
    expect(defaultTreatment({ ...base, customerType: "consumer", country: "CH" })).toBe("domestic");
  });

  it("flags the cases for the tax adviser", () => {
    expect(needsReview({ ...base, country: "AT" })).toBeNull();
    expect(needsReview({ ...base, country: "DE", vatId: "DE123456789" })).toBeNull();
    expect(needsReview({ ...base, country: "DE" })).toMatch(/ohne UID/);
    expect(needsReview({ ...base, customerType: "consumer", country: "FR" })).toMatch(/OSS/);
  });

  it("writes the tax note, an override wins", () => {
    expect(treatmentNote("small_business", "Kleinunternehmer")).toBe("Kleinunternehmer");
    expect(treatmentNote("reverse_charge", "x")).toMatch(/Reverse Charge/);
    expect(treatmentNote("non_taxable", "x")).toMatch(/§ 3a/);
    expect(treatmentNote("domestic", "x")).toBeNull();
    expect(treatmentNote("domestic", "x", "Eigener Hinweis")).toBe("Eigener Hinweis");
  });
});

describe("issueIssues (§ 11 UStG)", () => {
  const issuer: InvoiceIssuer = {
    name: "Studio Kapek",
    street: "Hauptstraße 1",
    postalCode: "1010",
    city: "Wien",
    country: "AT",
    vatId: "ATU12345678",
    email: null,
    iban: "AT611904300234573201",
    bic: null,
    bankName: null,
  };
  const recipient = {
    name: "Bäckerei Huber",
    street: "Gasse 2",
    postalCode: "8010",
    city: "Graz",
    country: "AT",
    vatId: null,
  };
  const input = (cents: number, extra: Partial<IssueCheckInput> = {}): IssueCheckInput => ({
    kind: "standard",
    treatment: "domestic",
    totals: invoiceTotals(doc({ treatment: "domestic", lines: [line("ab", cents)] })),
    hasLines: true,
    hasServicePeriod: true,
    issuer,
    recipient,
    customerType: "business",
    review: null,
    ...extra,
  });
  const errors = (value: IssueCheckInput) =>
    issueIssues(value)
      .filter((issue) => issue.level === "error")
      .map((issue) => issue.path);

  it("lets a complete invoice through", () => {
    expect(issueIssues(input(100_000))).toEqual([]);
  });

  it("needs the service date and the issuer's address always", () => {
    expect(errors(input(1_000, { hasServicePeriod: false }))).toEqual(["servicePeriod"]);
    expect(errors(input(1_000, { issuer: { ...issuer, street: null } }))).toEqual(["issuer"]);
  });

  it("needs the customer's address only above 400 € gross", () => {
    const anonymous = { ...recipient, street: null };
    expect(errors(input(33_000, { recipient: anonymous }))).toEqual([]);
    expect(errors(input(34_000, { recipient: anonymous }))).toEqual(["recipient"]);
  });

  it("needs the customer's UID above 10.000 € gross for a business", () => {
    expect(errors(input(833_300))).toEqual([]);
    expect(errors(input(833_400))).toEqual(["recipient.vatId"]);
    expect(errors(input(833_400, { customerType: "consumer" }))).toEqual([]);
  });

  it("checks reverse charge", () => {
    const totals = invoiceTotals(doc({ treatment: "reverse_charge", lines: [line("ab", 100)] }));
    expect(errors(input(0, { treatment: "reverse_charge", totals }))).toEqual([
      "recipient.vatId",
      "treatment",
    ]);
    expect(
      errors(
        input(0, {
          treatment: "reverse_charge",
          totals,
          recipient: { ...recipient, country: "DE", vatId: "DE123456789" },
        }),
      ),
    ).toEqual([]);
  });

  it("blocks a final invoice while deposit drafts are open", () => {
    expect(errors(input(1_000, { kind: "final", pendingDeposits: 1 }))).toEqual([undefined]);
    expect(errors(input(1_000, { kind: "final", pendingDeposits: 0 }))).toEqual([]);
  });

  it("refuses the small-business invoice that crosses the tolerance", () => {
    const totals = invoiceTotals(
      doc({ treatment: "small_business", lines: [line("ab", 200_000)] }),
    );
    const small = { treatment: "small_business" as const, totals };
    expect(errors(input(0, { ...small, smallBusinessRevenueCents: 5_800_000 }))).toEqual([]);
    expect(errors(input(0, { ...small, smallBusinessRevenueCents: 5_900_000 }))).toEqual([
      "treatment",
    ]);
  });

  it("needs the issuer's UID on a non-taxable invoice, not as a small business", () => {
    const noVatId = { ...issuer, vatId: null };
    const nonTaxable = invoiceTotals(
      doc({ treatment: "non_taxable", lines: [line("ab", 50_000)] }),
    );
    expect(
      errors(input(0, { treatment: "non_taxable", totals: nonTaxable, issuer: noVatId })),
    ).toEqual(["issuer.vatId"]);
    const small = invoiceTotals(doc({ treatment: "small_business", lines: [line("ab", 50_000)] }));
    expect(
      errors(input(0, { treatment: "small_business", totals: small, issuer: noVatId })),
    ).toEqual([]);
  });

  it("blocks empty and over-deducted invoices, warns without IBAN", () => {
    expect(errors(input(0, { hasLines: false }))).toContain("lines");
    const overDeducted = { ...input(100).totals, dueCents: -1 };
    expect(issueIssues(input(100, { totals: overDeducted })).map((i) => i.message)).toContain(
      "Die abgezogenen Anzahlungen sind höher als der Rechnungsbetrag.",
    );
    const withoutIban = issueIssues(input(100, { issuer: { ...issuer, iban: null } }));
    expect(withoutIban).toEqual([expect.objectContaining({ level: "warning" })]);
  });
});

describe("smallBusinessGuard", () => {
  it("warns at 80 %, then tolerance, then exceeded", () => {
    expect(smallBusinessGuard(4_000_000).level).toBe("ok");
    expect(smallBusinessGuard(4_400_000)).toMatchObject({ level: "warning", percent: 80 });
    expect(smallBusinessGuard(5_600_000).level).toBe("tolerance");
    expect(smallBusinessGuard(6_050_001).level).toBe("exceeded");
  });
});

describe("EPC QR code", () => {
  it("validates and normalises IBANs", () => {
    expect(normaliseIban("at61 1904 3002 3457 3201")).toBe("AT611904300234573201");
    expect(normaliseIban("DE89 3704 0044 0532 0130 00")).toBe("DE89370400440532013000");
    expect(normaliseIban("AT61 1904 3002 3457 3202")).toBeNull();
    expect(formatIban("AT611904300234573201")).toBe("AT61 1904 3002 3457 3201");
  });

  it("builds the payload, null outside the allowed amounts", () => {
    expect(
      epcPayload({
        name: "Studio Kapek",
        iban: "AT611904300234573201",
        amountCents: 123_405,
        reference: "RE-2026-0001",
      }),
    ).toBe("BCD\n002\n1\nSCT\n\nStudio Kapek\nAT611904300234573201\nEUR1234.05\n\n\nRE-2026-0001");
    expect(
      epcPayload({ name: "x", iban: "AT611904300234573201", amountCents: 0, reference: "" }),
    ).toBeNull();
  });
});

describe("invoicesCsv", () => {
  const row: CsvInvoice = {
    number: "RE-2026-0001",
    kind: "cancellation",
    issueDate: "2026-10-22",
    servicePeriod: "01.10.2026",
    customer: '=HYPERLINK("x"); "Huber"',
    customerVatId: null,
    country: "AT",
    treatment: "domestic",
    netCents: -10_000,
    vatCents: -2_000,
    totalCents: -12_000,
    deductedCents: 0,
    dueCents: -12_000,
    paidCents: 0,
    status: "storno",
    cancels: "RE-2026-0000",
  };

  it("writes semicolons, decimal commas and a BOM, and defuses formulas", () => {
    const csv = invoicesCsv([row]);
    expect(csv.startsWith("﻿Rechnungsnummer;Art;")).toBe(true);
    const [, data] = csv.trim().split("\r\n");
    expect(data).toContain("RE-2026-0001;Stornorechnung;22.10.2026;01.10.2026;");
    expect(data).toContain(`"'=HYPERLINK(""x""); ""Huber"""`);
    expect(data).toContain(";-100,00;-20,00;-120,00;0,00;-120,00;0,00;Storno;RE-2026-0000");
  });
});
