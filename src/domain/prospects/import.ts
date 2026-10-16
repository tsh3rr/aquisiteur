import { type z } from "zod";
import { contactFormSchema, prospectFormSchema, type ProspectForm } from "./schema";

/**
 * CSV import of prospects (§7.1). Accepts what spreadsheet programs export:
 * semicolon or comma, quoted cells, a BOM, CRLF. Columns are matched by
 * their (German or English) header; unknown columns are ignored.
 */

export const MAX_IMPORT_ROWS = 2000;

/** Splits CSV text into rows of cells (RFC 4180 quoting). */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, "");
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  // The most frequent separator in the header wins; ties go to ";" (German Excel).
  const delimiter = [";", ",", "\t"].reduce((best, candidate) =>
    count(firstLine, candidate) > count(firstLine, best) ? candidate : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

function count(text: string, char: string) {
  return text.split(char).length - 1;
}

export const IMPORT_FIELDS = [
  "companyName",
  "industry",
  "website",
  "street",
  "postalCode",
  "city",
  "phone",
  "email",
  "notes",
  "tags",
  "estimatedValue",
  "salutation",
  "firstName",
  "lastName",
  "role",
  "contactEmail",
  "contactPhone",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  companyName: "Firma",
  industry: "Branche",
  website: "Website",
  street: "Straße",
  postalCode: "PLZ",
  city: "Ort",
  phone: "Telefon",
  email: "E-Mail",
  notes: "Notizen",
  tags: "Tags",
  estimatedValue: "Auftragswert",
  salutation: "Anrede",
  firstName: "Vorname",
  lastName: "Nachname",
  role: "Funktion",
  contactEmail: "E-Mail Ansprechpartner",
  contactPhone: "Telefon Ansprechpartner",
};

const ALIASES: Record<ImportField, string[]> = {
  companyName: ["firma", "firmenname", "unternehmen", "name", "company", "companyname", "kunde"],
  industry: ["branche", "industry", "kategorie"],
  website: ["website", "webseite", "homepage", "url", "web"],
  street: ["strasse", "straße", "str", "adresse", "anschrift", "street", "address"],
  postalCode: ["plz", "postleitzahl", "zip", "postalcode", "postcode"],
  city: ["ort", "stadt", "city", "town"],
  phone: ["telefon", "tel", "phone", "telefonnummer"],
  email: ["email", "e-mail", "mail"],
  notes: ["notizen", "notiz", "bemerkung", "notes", "kommentar"],
  tags: ["tags", "schlagworte", "labels"],
  estimatedValue: ["auftragswert", "wert", "value", "budget"],
  salutation: ["anrede", "salutation"],
  firstName: ["vorname", "firstname"],
  lastName: ["nachname", "lastname", "familienname", "ansprechpartner", "kontakt", "contact"],
  role: ["funktion", "position", "rolle", "role"],
  contactEmail: ["emailansprechpartner", "kontaktemail", "contactemail"],
  contactPhone: ["telefonansprechpartner", "kontakttelefon", "contactphone", "mobil"],
};

const normaliseHeader = (header: string) =>
  header
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[^a-z]/g, "");

/** Header index → field, first match wins; null for columns that are ignored. */
export function mapHeaders(headers: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>();
  return headers.map((header) => {
    const key = normaliseHeader(header);
    const field = IMPORT_FIELDS.find(
      (candidate) =>
        !used.has(candidate) && ALIASES[candidate].some((alias) => normaliseHeader(alias) === key),
    );
    if (!field) return null;
    used.add(field);
    return field;
  });
}

export interface ImportRow {
  line: number;
  prospect: ProspectForm;
  contact: z.output<typeof contactFormSchema> | null;
}

export interface ImportProblem {
  line: number;
  message: string;
}

export interface ImportPreview {
  fields: (ImportField | null)[];
  rows: ImportRow[];
  problems: ImportProblem[];
}

/** Validates every data row; rows with errors are reported, not imported. */
export function previewImport(text: string): ImportPreview {
  const [headers, ...data] = parseCsv(text);
  if (!headers)
    return { fields: [], rows: [], problems: [{ line: 1, message: "Die Datei ist leer." }] };
  const fields = mapHeaders(headers);
  if (!fields.includes("companyName")) {
    return {
      fields,
      rows: [],
      problems: [
        { line: 1, message: "Es fehlt eine Spalte „Firma“ (oder „Unternehmen“, „Name“)." },
      ],
    };
  }
  if (data.length > MAX_IMPORT_ROWS) {
    return {
      fields,
      rows: [],
      problems: [{ line: 1, message: `Höchstens ${MAX_IMPORT_ROWS} Zeilen pro Import.` }],
    };
  }
  const rows: ImportRow[] = [];
  const problems: ImportProblem[] = [];
  data.forEach((cells, index) => {
    const line = index + 2;
    const values: Partial<Record<ImportField, string>> = {};
    fields.forEach((field, column) => {
      if (field) values[field] = cells[column]?.trim() ?? "";
    });
    if (values.website && !/^https?:\/\//i.test(values.website)) {
      values.website = `https://${values.website}`;
    }
    const prospect = prospectFormSchema.safeParse({
      companyName: values.companyName ?? "",
      industry: values.industry,
      website: values.website,
      street: values.street,
      postalCode: values.postalCode,
      city: values.city,
      phone: values.phone,
      email: values.email,
      notes: values.notes,
      tags: values.tags?.replace(/[;|]/g, ","),
      estimatedValue: values.estimatedValue,
    });
    if (!prospect.success) {
      problems.push({ line, message: prospect.error.issues[0]!.message });
      return;
    }
    let contact: ImportRow["contact"] = null;
    if (values.firstName || values.lastName) {
      const parsed = contactFormSchema.safeParse({
        salutation: values.salutation,
        firstName: values.firstName,
        lastName: values.lastName,
        role: values.role,
        email: values.contactEmail,
        phone: values.contactPhone,
      });
      if (!parsed.success) {
        problems.push({ line, message: `Ansprechpartner: ${parsed.error.issues[0]!.message}` });
        return;
      }
      contact = parsed.data;
    }
    rows.push({ line, prospect: prospect.data, contact });
  });
  return { fields, rows, problems };
}

/** Same company at the same place: treated as already known. */
export function duplicateKey(row: { companyName: string; city: string | null }) {
  return `${row.companyName.trim().toLowerCase()}|${(row.city ?? "").trim().toLowerCase()}`;
}
