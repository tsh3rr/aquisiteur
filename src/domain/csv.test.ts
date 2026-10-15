import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("separates with semicolons, quotes where needed and starts with a BOM", () => {
    const csv = toCsv([
      ["Firma", "Notiz"],
      ["Café Müller", 'Sagt "ja"; vielleicht'],
      ["Zeile\nzwei", null],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe(
      'Firma;Notiz\r\nCafé Müller;"Sagt ""ja""; vielleicht"\r\n"Zeile\nzwei";\r\n',
    );
  });

  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(toCsv([["=HYPERLINK(1)", "+49 341", "@x", "-1"]]).slice(1)).toBe(
      "'=HYPERLINK(1);'+49 341;'@x;'-1\r\n",
    );
    expect(toCsv([[-1, 42]]).slice(1)).toBe("-1;42\r\n");
  });
});
