import { describe, expect, it } from "vitest";
import {
  composeLetter,
  fillPlaceholders,
  letterPrivacyNote,
  salutationFor,
  type LetterInput,
} from "./compose";

const input: LetterInput = {
  sender: {
    company: "Pixelwerk Leipzig",
    street: "Karl-Liebknecht-Straße 12",
    postalCode: "04107",
    city: "Leipzig",
    country: "DE",
    name: "Jonas Becker",
    role: "Webdesigner",
    phone: "+49 341 1234567",
    email: "hallo@pixelwerk.example",
    website: null,
  },
  recipient: {
    companyName: "Café Müller",
    street: "Gottschedstraße 7",
    postalCode: "04109",
    city: "Leipzig",
    country: "DE",
    contact: { salutation: "Frau", firstName: "Sabine", lastName: "Müller" },
  },
  subject: "Ein paar Ideen für {{firma}}",
  body: "ich war bei {{firma}} in {{ort}}. Link: {{kurzlink}}",
  closing: "Mit freundlichen Grüßen",
  qrHint: "Scannen Sie den Code.",
  shortLink: "pixelwerk.de/k7m2",
  qrUrl: "https://pixelwerk.de/AbCdEf123456",
  date: new Date("2026-10-16T10:00:00Z"),
  timeZone: "Europe/Berlin",
  signatureUrl: null,
  privacy: {
    dataSource: "Ihrem Google-Unternehmensprofil",
    privacyUrl: "pixelwerk.de/datenschutz",
  },
};

describe("composeLetter", () => {
  it("fills the window, the salutation and the placeholders", () => {
    const letter = composeLetter(input);
    expect(letter.address).toEqual([
      "Café Müller",
      "Frau Sabine Müller",
      "Gottschedstraße 7",
      "04109 Leipzig",
    ]);
    expect(letter.returnAddress).toBe(
      "Pixelwerk Leipzig · Karl-Liebknecht-Straße 12 · 04107 Leipzig",
    );
    expect(letter.subject).toBe("Ein paar Ideen für Café Müller");
    expect(letter.salutation).toBe("Sehr geehrte Frau Müller,");
    expect(letter.body).toBe("ich war bei Café Müller in Leipzig. Link: pixelwerk.de/k7m2");
    expect(letter.date).toBe("16. Oktober 2026");
    expect(letter.missing).toEqual([]);
    expect(letter.senderContact).toEqual(["Telefon +49 341 1234567", "hallo@pixelwerk.example"]);
    expect(letter.footer.at(-1)).toBe("Telefon +49 341 1234567 · hallo@pixelwerk.example");
  });

  it("keeps a salutation the text brings itself", () => {
    const letter = composeLetter({ ...input, body: "Sehr geehrte Frau Müller,\n\nText" });
    expect(letter.salutation).toBeNull();
    for (const body of ["Sehr geehrter Herr Brandt,\n\nText", "Lieber Marco,\n\nText"]) {
      expect(composeLetter({ ...input, body }).salutation).toBeNull();
    }
  });

  it("adds the country abroad and reports empty placeholders", () => {
    const letter = composeLetter({
      ...input,
      recipient: { ...input.recipient, country: "AT", contact: null },
      body: "Hallo {{ansprechpartner}}",
    });
    expect(letter.address.at(-1)).toBe("ÖSTERREICH");
    expect(letter.missing).toEqual(["ansprechpartner"]);
  });
});

describe("salutationFor", () => {
  it("falls back politely", () => {
    expect(salutationFor({ salutation: "Herr", firstName: null, lastName: "Kern" })).toBe(
      "Sehr geehrter Herr Kern,",
    );
    expect(salutationFor(null)).toBe("Sehr geehrte Damen und Herren,");
  });
});

describe("fillPlaceholders", () => {
  it("leaves unknown placeholders visible", () => {
    expect(fillPlaceholders("{{foo}} {{firma}}", { firma: "A" }).text).toBe("{{foo}} A");
  });
});

describe("privacy note in the letter", () => {
  it("names the source, the personal link and the objection (Art. 14, 21 DSGVO)", () => {
    const note = composeLetter(input).privacyNote;
    expect(note).toContain("aus Ihrem Google-Unternehmensprofil");
    expect(note).toContain("Wenn Sie die Seite öffnen, sehe ich das");
    expect(note).toContain("nur mit Ihrer Zustimmung");
    expect(note).toContain("an hallo@pixelwerk.example");
    expect(note).toContain("Details: pixelwerk.de/datenschutz");
  });

  it("works without an e-mail address", () => {
    const note = letterPrivacyNote({
      dataSource: "X",
      privacyUrl: "a.de/datenschutz",
      email: null,
    });
    expect(note).toContain("per Klick auf „Kein Interesse“ auf der Seite.");
  });
});
