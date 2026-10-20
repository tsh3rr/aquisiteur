import type { ComposedLetter } from "@/domain/letters/compose";
import type { PrintableTeaser } from "@/domain/letters/teaser";

/** A letter as the PDF renderer gets it (serialisable, no Dates). */
export interface PrintableLetterData extends ComposedLetter {
  id: string;
  prospectId: string;
  companyName: string;
  qrModules: { size: number; path: string };
  problems: string[];
  /** Agency logo for the letterhead (cockpit URL, later a data URL); null prints the name. */
  senderLogo: string | null;
  /** Printed on both sides: page 2 is then the back of page 1. */
  duplex: boolean;
  /** Second page with a teaser of the exposé; null prints the classic letter. */
  teaser: PrintableTeaser | null;
}
