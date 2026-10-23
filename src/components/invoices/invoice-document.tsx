import { Document, Image, Page, Path, pdf, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { facturXml } from "@/domain/invoices/cii";
import { formatIban } from "@/domain/invoices/epc";
import { INVOICE_KIND_LABELS, WITHOUT_VAT } from "@/domain/invoices/schema";
import { germanDate, servicePeriodLabel } from "@/domain/invoices/totals";
import { formatCents, formatQuantity } from "@/domain/offers/totals";
import "../letters/pdf-fonts";
import { printableImage } from "../letters/pdf-image";
import { embedFacturX } from "./facturx";
import type { PrintableInvoice } from "./types";

/**
 * The invoice PDF (§7.10, phase 7b): A4, address field for a DL window
 * envelope like the letters, every § 11 UStG item, the EPC QR code to pay
 * with a banking app. Rendered in the browser (ADR-0037).
 */

const mm = (value: number) => value * 2.8346;

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 9.5,
    lineHeight: 1.4,
    color: "#111111",
    paddingTop: mm(100),
    paddingBottom: mm(30),
    paddingLeft: mm(25),
    paddingRight: mm(20),
  },
  firstPageTop: { position: "absolute", top: 0, left: 0, right: 0 },
  issuerName: { position: "absolute", top: mm(18), left: mm(25), fontSize: 14, fontWeight: 600 },
  logo: {
    position: "absolute",
    top: mm(15),
    left: mm(25),
    height: mm(18),
    maxWidth: mm(80),
    objectFit: "contain",
    objectPositionX: 0,
  },
  returnAddress: {
    position: "absolute",
    top: mm(45 + 6),
    left: mm(25),
    width: mm(85),
    fontSize: 7,
    color: "#333333",
    textDecoration: "underline",
  },
  address: { position: "absolute", top: mm(56), left: mm(25), width: mm(85), fontSize: 10 },
  info: { position: "absolute", top: mm(51), left: mm(125), width: mm(65), fontSize: 9 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 1.5 },
  infoLabel: { color: "#555555" },
  title: { fontSize: 14, fontWeight: 600, marginBottom: mm(4) },
  draft: { color: "#b42318", fontWeight: 600, marginBottom: mm(2) },
  paragraph: { marginBottom: mm(4) },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: "#111111",
    paddingBottom: 3,
    fontWeight: 600,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: "#cccccc",
    paddingVertical: 4,
  },
  pos: { width: mm(9) },
  item: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: mm(3) },
  qty: { width: mm(24), textAlign: "right" },
  price: { width: mm(24), textAlign: "right" },
  amount: { width: mm(26), textAlign: "right" },
  description: { color: "#555555", fontSize: 8.5 },
  totals: { marginTop: mm(4), marginLeft: mm(85) },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: "#111111",
    marginTop: 2,
    paddingTop: 3,
    fontWeight: 600,
    fontSize: 10.5,
  },
  note: { marginTop: mm(5), fontSize: 8.5 },
  payment: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: mm(6),
    padding: mm(3),
    borderWidth: 0.75,
    borderColor: "#111111",
    borderRadius: mm(2),
  },
  paymentText: { flexGrow: 1, flexShrink: 1, marginLeft: mm(4) },
  footer: {
    position: "absolute",
    bottom: mm(10),
    left: mm(25),
    right: mm(20),
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: "#555555",
    borderTopWidth: 0.4,
    borderTopColor: "#999999",
    paddingTop: 4,
  },
});

const COUNTRY: Record<string, string> = {
  AT: "Österreich",
  DE: "Deutschland",
  CH: "Schweiz",
  IT: "Italien",
  LI: "Liechtenstein",
};

function addressLines(party: PrintableInvoice["recipient"], home: string): string[] {
  return [
    party.name,
    party.street ?? "",
    [party.postalCode, party.city].filter(Boolean).join(" "),
    party.country !== home ? (COUNTRY[party.country] ?? party.country) : "",
  ].filter(Boolean);
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

function TotalRow({
  label,
  value,
  bold,
  accent,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: string;
}) {
  return (
    <View
      style={bold ? [styles.grandTotal, accent ? { borderTopColor: accent } : {}] : styles.totalRow}
    >
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
}

export function InvoicePages({ invoice }: { invoice: PrintableInvoice }) {
  const { issuer, recipient, totals, document } = invoice;
  const withoutVat = WITHOUT_VAT.has(document.treatment);
  const kindLabel = INVOICE_KIND_LABELS[invoice.kind];
  const deductions = document.deductions;
  const hasDiscount = totals.discountCents !== 0;
  // Lines, headings and the payment box take the agency's accent; amounts stay black.
  const accent = invoice.brand.accent ?? "#111111";
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.firstPageTop} fixed={false}>
        {invoice.brand.logo ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF image, not HTML
          <Image src={invoice.brand.logo} style={styles.logo} />
        ) : (
          <Text style={[styles.issuerName, { color: accent }]}>{issuer.name}</Text>
        )}
        <Text style={styles.returnAddress}>
          {[issuer.name, issuer.street, [issuer.postalCode, issuer.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <View style={styles.address}>
          {addressLines(recipient, issuer.country).map((line, index) => (
            <Text key={index}>{line}</Text>
          ))}
        </View>
        <View style={styles.info}>
          <InfoRow label="Rechnungsnummer" value={invoice.number ?? "Entwurf"} />
          <InfoRow label="Rechnungsdatum" value={germanDate(invoice.issueDate)} />
          <InfoRow
            label={document.servicePeriod?.to ? "Leistungszeitraum" : "Leistungsdatum"}
            value={servicePeriodLabel(document.servicePeriod)}
          />
          {invoice.dueDate && invoice.kind !== "cancellation" ? (
            <InfoRow label="Zahlbar bis" value={germanDate(invoice.dueDate)} />
          ) : null}
          {recipient.vatId ? <InfoRow label="UID Kunde" value={recipient.vatId} /> : null}
          {issuer.vatId ? <InfoRow label="Unsere UID" value={issuer.vatId} /> : null}
          {invoice.offerNumber ? <InfoRow label="Angebot" value={invoice.offerNumber} /> : null}
        </View>
      </View>

      {invoice.status === "draft" ? (
        <Text style={styles.draft}>Entwurf – keine gültige Rechnung</Text>
      ) : null}
      <Text style={[styles.title, { color: accent }]}>
        {kindLabel} {invoice.number ?? ""}
      </Text>
      {invoice.cancels ? (
        <Text style={styles.paragraph}>Storno zur Rechnung {invoice.cancels}.</Text>
      ) : null}
      {document.intro ? <Text style={styles.paragraph}>{document.intro}</Text> : null}

      <View style={[styles.tableHead, { borderBottomColor: accent }]} fixed>
        <Text style={styles.pos}>Pos.</Text>
        <Text style={styles.item}>Leistung</Text>
        <Text style={styles.qty}>Menge</Text>
        <Text style={styles.price}>Einzelpreis</Text>
        <Text style={styles.amount}>Betrag</Text>
      </View>
      {totals.lines.map((line, index) => (
        <View key={line.id} style={styles.row} wrap={false}>
          <Text style={styles.pos}>{index + 1}</Text>
          <View style={styles.item}>
            <Text>
              {line.title}
              {!withoutVat ? ` (${line.vatRate} % USt)` : ""}
            </Text>
            {line.description ? <Text style={styles.description}>{line.description}</Text> : null}
            {line.discountPercent > 0 ? (
              <Text style={styles.description}>
                abzüglich {formatQuantity(line.discountPercent)} % Rabatt
              </Text>
            ) : null}
          </View>
          <Text style={styles.qty}>
            {formatQuantity(line.quantity)} {line.unit}
          </Text>
          <Text style={styles.price}>{formatCents(line.unitPriceCents)}</Text>
          <Text style={styles.amount}>{formatCents(line.netCents)}</Text>
        </View>
      ))}

      <View style={styles.totals} wrap={false}>
        {hasDiscount ? (
          <>
            <TotalRow label="Summe Positionen" value={formatCents(totals.linesCents)} />
            <TotalRow
              label={`Gesamtrabatt ${formatQuantity(document.discountPercent)} %`}
              value={formatCents(-totals.discountCents)}
            />
          </>
        ) : null}
        {withoutVat ? null : (
          <>
            <TotalRow label="Summe netto" value={formatCents(totals.netCents)} />
            {totals.vat.map((entry) => (
              <TotalRow
                key={entry.rate}
                label={`USt ${entry.rate} % auf ${formatCents(entry.baseCents)}`}
                value={formatCents(entry.vatCents)}
              />
            ))}
          </>
        )}
        <TotalRow
          label={withoutVat ? "Gesamtbetrag" : "Gesamtbetrag brutto"}
          value={formatCents(totals.totalCents)}
          bold
          accent={accent}
        />
        {deductions.length > 0 ? (
          <>
            {deductions.map((deduction) => {
              const net = deduction.byRate.reduce((sum, entry) => sum + entry.netCents, 0);
              const vat = deduction.byRate.reduce((sum, entry) => sum + entry.vatCents, 0);
              return (
                <TotalRow
                  key={deduction.invoiceId}
                  label={`abzüglich Anzahlung ${deduction.number} vom ${germanDate(deduction.issueDate)}${
                    withoutVat ? "" : ` (netto ${formatCents(net)}, USt ${formatCents(vat)})`
                  }`}
                  value={formatCents(-(net + vat))}
                />
              );
            })}
            <TotalRow
              label="Noch zu zahlen"
              value={formatCents(totals.dueCents)}
              bold
              accent={accent}
            />
          </>
        ) : null}
      </View>

      {invoice.taxNote ? <Text style={styles.note}>{invoice.taxNote}</Text> : null}

      {invoice.kind !== "cancellation" && totals.dueCents > 0 ? (
        <View style={[styles.payment, { borderColor: accent }]} wrap={false}>
          {invoice.qr ? (
            <Svg
              width={mm(26)}
              height={mm(26)}
              viewBox={`0 0 ${invoice.qr.size} ${invoice.qr.size}`}
            >
              <Path d={invoice.qr.path} fill="#000000" />
            </Svg>
          ) : null}
          <View style={invoice.qr ? styles.paymentText : { flexGrow: 1 }}>
            <Text style={{ fontWeight: 600 }}>
              Bitte überweisen Sie {formatCents(totals.dueCents)}
              {invoice.dueDate ? ` bis ${germanDate(invoice.dueDate)}` : ""}.
            </Text>
            {issuer.iban ? (
              <Text>
                IBAN {formatIban(issuer.iban)}
                {issuer.bic ? ` · BIC ${issuer.bic}` : ""}
                {issuer.bankName ? ` · ${issuer.bankName}` : ""}
              </Text>
            ) : null}
            <Text>Verwendungszweck: {invoice.number ?? "Rechnungsnummer"}</Text>
            {invoice.qr ? (
              <Text style={styles.description}>
                Zahlen mit Code: QR-Code mit der Banking-App scannen.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {document.outro ? <Text style={styles.note}>{document.outro}</Text> : null}

      <View style={styles.footer} fixed>
        <Text>
          {[issuer.name, issuer.street, [issuer.postalCode, issuer.city].filter(Boolean).join(" ")]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        <Text>
          {[issuer.vatId ? `UID ${issuer.vatId}` : null, issuer.email].filter(Boolean).join(" · ")}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
      </View>
    </Page>
  );
}

export async function renderInvoicePdf(input: PrintableInvoice): Promise<Blob> {
  // react-pdf cannot read WebP; the logo goes through a canvas like the letters' images.
  const logo = input.brand.logo ? await printableImage(input.brand.logo) : null;
  const invoice = { ...input, brand: { ...input.brand, logo } };
  const title = `${INVOICE_KIND_LABELS[invoice.kind]} ${invoice.number ?? "Entwurf"}`;
  const blob = await pdf(
    <Document title={title} author={invoice.issuer.name} language="de">
      <InvoicePages invoice={invoice} />
    </Document>,
  ).toBlob();
  // Issued invoices carry the e-invoice (ZUGFeRD / Factur-X); a draft stays a plain preview.
  if (!invoice.number) return blob;
  const xml = facturXml({ ...invoice, number: invoice.number });
  const bytes = await embedFacturX(await blob.arrayBuffer(), xml, {
    title,
    author: invoice.issuer.name,
  });
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
