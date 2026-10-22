import { describe, expect, it } from "vitest";
import { INVOICE_EMAIL_BODY, INVOICE_EMAIL_SUBJECT, fillTemplate, invoiceEmail } from "./email";

const input = {
  kind: "deposit" as const,
  number: "RE-2026-0007",
  dueCents: 120_000,
  dueDate: "2026-11-05",
  link: "https://studio.example/r/abc?x=1&y=2",
  sender: "Studio <M>",
  customer: "Bäckerei Huber",
  subject: INVOICE_EMAIL_SUBJECT,
  body: INVOICE_EMAIL_BODY,
};

describe("invoice mail", () => {
  it("fills the placeholders and leaves unknown ones", () => {
    expect(fillTemplate("{nummer} {gibtsnicht}", { ...emptyValues(), nummer: "RE-1" })).toBe(
      "RE-1 {gibtsnicht}",
    );
  });

  it("writes subject, text and escaped HTML with a clickable link", () => {
    const mail = invoiceEmail(input);
    expect(mail.subject).toBe("Anzahlungsrechnung RE-2026-0007 von Studio <M>");
    expect(mail.text).toContain("über 1.200,00 €, zahlbar bis 05.11.2026");
    expect(mail.text).toContain(input.link);
    expect(mail.html).toContain(
      '<a href="https://studio.example/r/abc?x=1&amp;y=2">https://studio.example/r/abc?x=1&amp;y=2</a>',
    );
    expect(mail.html).toContain("Studio &lt;M&gt;");
    expect(mail.html).not.toContain("<M>");
  });

  it("keeps the subject on one line", () => {
    expect(invoiceEmail({ ...input, subject: "Rechnung\r\nBcc: x@y.de" }).subject).toBe(
      "Rechnung Bcc: x@y.de",
    );
  });
});

function emptyValues() {
  return { art: "", nummer: "", betrag: "", faellig: "", link: "", absender: "", kunde: "" };
}
