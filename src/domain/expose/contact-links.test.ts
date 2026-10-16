import { describe, expect, it } from "vitest";
import { contactLinks, telHref, whatsappNumber } from "./contact-links";

describe("whatsappNumber()", () => {
  it.each([
    ["+49 170 1234567", "491701234567"],
    ["0170 1234567", "491701234567"],
    ["0049 (170) 123-4567", "491701234567"],
    ["+43 660 1234567", "436601234567"],
    ["123", null],
  ])("%s → %s", (raw, expected) => {
    expect(whatsappNumber(raw)).toBe(expected);
  });
});

describe("contactLinks()", () => {
  const settings = {
    email: "hallo@agentur.test",
    phone: "+49 341 1234567",
    whatsapp: "+49 170 1234567",
  };

  it("builds links with the reference code in the prefilled text", () => {
    const links = contactLinks({
      channels: ["whatsapp", "phone", "email"],
      settings,
      message: undefined,
      company: "Café Müller",
      refCode: "K7M2",
    });
    expect(links.map((link) => link.channel)).toEqual(["whatsapp", "phone", "email"]);
    expect(decodeURIComponent(links[0]!.href)).toBe(
      "https://wa.me/491701234567?text=Hallo, ich habe Ihre Vorschläge für Café Müller gesehen. [Ref K7M2]",
    );
    expect(links[1]!.href).toBe("tel:+493411234567");
    expect(decodeURIComponent(links[2]!.href)).toContain(
      "subject=Ihre Vorschläge für Café Müller [Ref K7M2]",
    );
  });

  it("skips channels without data and keeps the requested order", () => {
    const links = contactLinks({
      channels: ["email", "whatsapp"],
      settings: { email: "a@b.test" },
      message: "Hi",
      company: "X",
      refCode: "AAAA",
    });
    expect(links.map((link) => link.channel)).toEqual(["email"]);
    expect(telHref("0341 / 12 34-5")).toBe("tel:034112345");
  });

  it("builds the prepared channels and leaves chat and callback to the page", () => {
    const links = contactLinks({
      channels: ["chat", "booking", "messenger", "sms", "callback"],
      settings: {
        bookingUrl: "https://cal.com/pixelwerk",
        messengerPage: "pixelwerk.leipzig",
        mobile: "0170 1234567",
      },
      message: undefined,
      company: "Café Müller",
      refCode: "K7M2",
    });
    expect(links.map((link) => [link.channel, link.external])).toEqual([
      ["booking", true],
      ["messenger", true],
      ["sms", false],
    ]);
    expect(links[0]!.display).toBe("cal.com");
    expect(links[1]!.href).toBe("https://m.me/pixelwerk.leipzig?ref=K7M2");
    expect(decodeURIComponent(links[2]!.href)).toBe(
      "sms:01701234567?&body=Hallo, ich habe Ihre Vorschläge für Café Müller gesehen. [Ref K7M2]",
    );
  });
});
