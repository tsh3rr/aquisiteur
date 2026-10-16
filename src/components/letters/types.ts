import type { ComposedLetter } from "@/domain/letters/compose";

/** A letter as the PDF renderer gets it (serialisable, no Dates). */
export interface PrintableLetterData extends ComposedLetter {
  id: string;
  prospectId: string;
  companyName: string;
  qrModules: { size: number; path: string };
  problems: string[];
}
