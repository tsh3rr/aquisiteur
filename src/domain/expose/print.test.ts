import { describe, expect, it } from "vitest";
import { exposeImages, exposePdfFilename, printContacts, printPricing } from "./print";
import type { BlockOf, ExposeDocument } from "./schema";

const image = (src: string) => ({ src, alt: src });

describe("exposeImages", () => {
  it("collects every image the blocks and the theme use", () => {
    const document = {
      theme: { logo: image("logo.png") },
      blocks: [
        { id: "start", type: "hero", image: image("hero.webp") },
        { id: "vorher", type: "before_after", before: image("a.webp"), after: image("b.webp") },
        { id: "bilder", type: "mockup_gallery", images: [image("g1.webp")] },
        { id: "stimmen", type: "testimonials", items: [{ photo: image("p.webp") }, {}] },
        { id: "faq", type: "faq", items: [] },
      ],
    } as unknown as ExposeDocument;
    expect(exposeImages(document).map((entry) => entry.src)).toEqual([
      "logo.png",
      "hero.webp",
      "a.webp",
      "b.webp",
      "g1.webp",
      "p.webp",
    ]);
  });
});

describe("printContacts", () => {
  it("lists the owner's channels with working links", () => {
    expect(
      printContacts({
        phone: "0341 123456",
        mobile: "0341 123456",
        whatsapp: "0170 1234567",
        email: "hallo@agentur.de",
        bookingUrl: "https://cal.com/agentur/",
      }),
    ).toEqual([
      { kind: "phone", label: "Telefon", value: "0341 123456", href: "tel:0341123456" },
      {
        kind: "whatsapp",
        label: "WhatsApp",
        value: "0170 1234567",
        href: "https://wa.me/491701234567",
      },
      {
        kind: "email",
        label: "E-Mail",
        value: "hallo@agentur.de",
        href: "mailto:hallo@agentur.de",
      },
      {
        kind: "booking",
        label: "Termin",
        value: "cal.com/agentur",
        href: "https://cal.com/agentur/",
      },
    ]);
  });
});

describe("printPricing", () => {
  const block = {
    id: "preise",
    type: "pricing",
    title: "Preise",
    currency: "EUR",
    vatNote: "netto",
    options: [
      {
        id: "basis",
        title: "Website",
        price: 2000,
        priceTo: 2500,
        billing: "once",
        selected: true,
        required: true,
      },
      { id: "shop", title: "Shop", price: 1500, billing: "once", selected: true, required: false },
      {
        id: "pflege",
        title: "Pflege",
        price: 49,
        billing: "monthly",
        selected: false,
        required: false,
      },
    ],
  } as unknown as BlockOf<"pricing">;

  it("uses the preselection without the reader's choice", () => {
    const pricing = printPricing(block, null);
    expect(pricing.rows.map((row) => [row.price, row.mark])).toEqual([
      ["2.000 € – 2.500 €", "included"],
      ["1.500 €", "selected"],
      ["49 € / Monat", null],
    ]);
    expect(pricing.totals).toEqual([{ label: "Einmalig", value: "3.500 € – 4.000 €" }]);
  });

  it("follows what the reader ticked on the page", () => {
    const pricing = printPricing(block, new Set(["pflege"]));
    expect(pricing.rows.map((row) => row.mark)).toEqual(["included", null, "selected"]);
    expect(pricing.totals).toEqual([
      { label: "Einmalig", value: "2.000 € – 2.500 €" },
      { label: "Monatlich", value: "49 € / Monat" },
    ]);
  });
});

describe("exposePdfFilename", () => {
  it("keeps the company name in plain ASCII without characters file systems refuse", () => {
    expect(exposePdfFilename("Café Müller")).toBe("Expose Cafe Mueller.pdf");
    expect(exposePdfFilename('A/B: "Test"')).toBe("Expose A B Test.pdf");
    expect(exposePdfFilename("  ")).toBe("Expose Angebot.pdf");
  });
});
