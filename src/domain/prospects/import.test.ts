import { describe, expect, it } from "vitest";
import { duplicateKey, mapHeaders, parseCsv, previewImport } from "./import";

describe("parseCsv", () => {
  it("reads semicolon CSV from Excel with BOM, quotes and CRLF", () => {
    const text = '﻿Firma;Ort\r\n"Café ""Müller""";Leipzig\r\n"Zwei\nZeilen";Halle\r\n';
    expect(parseCsv(text)).toEqual([
      ["Firma", "Ort"],
      ['Café "Müller"', "Leipzig"],
      ["Zwei\nZeilen", "Halle"],
    ]);
  });

  it("detects commas and drops empty lines", () => {
    expect(parseCsv("name,city\nA,B\n\n")).toEqual([
      ["name", "city"],
      ["A", "B"],
    ]);
  });
});

describe("mapHeaders", () => {
  it("matches German and English headers, ignores unknown ones", () => {
    expect(mapHeaders(["Unternehmen", "PLZ", "Stadt", "Straße", "Foo", "E-Mail"])).toEqual([
      "companyName",
      "postalCode",
      "city",
      "street",
      null,
      "email",
    ]);
  });
});

describe("previewImport", () => {
  it("validates rows and reports problems by line", () => {
    const preview = previewImport(
      [
        "Firma;Ort;Website;E-Mail;Vorname;Nachname;Tags",
        "Café Müller;Leipzig;cafe-mueller.de;info@cafe.de;Anna;Müller;Café; Leipzig",
        ";Halle;;;;;",
        "Bäckerei;Halle;;keine-mail;;;",
      ].join("\n"),
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]!.prospect).toMatchObject({
      companyName: "Café Müller",
      website: "https://cafe-mueller.de",
      tags: ["café"],
    });
    expect(preview.rows[0]!.contact).toMatchObject({ firstName: "Anna", lastName: "Müller" });
    expect(preview.problems.map((p) => p.line)).toEqual([3, 4]);
  });

  it("needs a company column", () => {
    expect(previewImport("Ort\nLeipzig").problems[0]!.message).toMatch(/Firma/);
  });

  it("keys duplicates by company and city", () => {
    expect(duplicateKey({ companyName: " Café ", city: "Leipzig" })).toBe("café|leipzig");
  });
});
