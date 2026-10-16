/**
 * CSV for spreadsheet programs: semicolon-separated (German Excel default),
 * CRLF, UTF-8 with BOM. Cells that a spreadsheet would run as a formula
 * (=, +, -, @, tab, CR) get a leading apostrophe (CSV injection).
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return "";
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${rows.map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
}
