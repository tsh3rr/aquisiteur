import type { ComposedLetter } from "@/domain/letters/compose";
import type { LetterTeaser } from "@/domain/letters/teaser";

interface PrintImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/** A letter as the PDF renderer gets it (serialisable, no Dates). */
export interface PrintableLetterData extends ComposedLetter {
  id: string;
  prospectId: string;
  companyName: string;
  qrModules: { size: number; path: string };
  problems: string[];
  /** Second page with a teaser of the exposé; null prints the classic letter. */
  teaser:
    | (Omit<LetterTeaser, "image" | "logo"> & {
        image: PrintImage | null;
        logo: PrintImage | null;
        ownerPhoto: string | null;
      })
    | null;
}
