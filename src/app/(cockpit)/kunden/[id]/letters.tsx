"use client";

import Link from "next/link";
import { LetterPdfButton } from "@/components/letters/pdf-button";
import { Badge } from "@/components/ui/badge";
import {
  formatTimeToOpen,
  LETTER_STATUS_LABELS,
  LETTER_STATUS_TONES,
  type LetterKind,
  type LetterStatus,
} from "@/domain/letters/lifecycle";
import { printableLettersAction } from "../../briefe/actions";

const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });

/** Letters on the customer page (§7.8 „Briefe mit Versandstatus“). */
export function ProspectLetters({
  prospectId,
  letters,
  canManage,
}: {
  prospectId: string;
  letters: {
    id: string;
    kind: LetterKind;
    status: LetterStatus;
    shortCode: string | null;
    postedAt: string | null;
    openedAt: string | null;
  }[];
  canManage: boolean;
}) {
  const hasInitial = letters.some(
    (letter) => letter.kind === "initial" && letter.status !== "cancelled",
  );
  return (
    <div className="grid gap-4">
      {letters.length === 0 ? (
        <p className="text-sm text-foreground-muted">Noch kein Brief.</p>
      ) : (
        <ul className="grid gap-3">
          {letters.map((letter) => (
            <li key={letter.id} className="grid gap-1 text-sm">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {letter.kind === "initial" ? "Erster Brief" : "Folgebrief"}
                </span>
                <Badge tone={LETTER_STATUS_TONES[letter.status]}>
                  {LETTER_STATUS_LABELS[letter.status]}
                </Badge>
                {letter.shortCode ? (
                  <span className="font-mono text-xs text-foreground-muted">
                    /{letter.shortCode}
                  </span>
                ) : null}
              </span>
              <span className="text-foreground-muted">
                {letter.postedAt
                  ? `Versendet am ${day.format(new Date(letter.postedAt))}`
                  : "Noch nicht versendet"}
                {letter.postedAt && letter.openedAt
                  ? `, geöffnet nach ${formatTimeToOpen(new Date(letter.postedAt), new Date(letter.openedAt))}`
                  : ""}
              </span>
              {canManage ? (
                <LetterPdfButton
                  ids={[letter.id]}
                  load={printableLettersAction}
                  filename="brief.pdf"
                  label="PDF"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <p className="flex flex-wrap gap-x-4 text-sm">
          <Link
            href={`/briefe/neu?ids=${prospectId}${hasInitial ? "&art=folgebrief" : ""}`}
            className="inline-flex min-h-11 items-center font-medium text-accent underline-offset-4 hover:underline"
          >
            {hasInitial ? "Folgebrief erstellen" : "Brief erstellen"}
          </Link>
          {letters.some((letter) => letter.status !== "posted" && letter.status !== "cancelled") ? (
            <Link
              href="/briefe?status=offen"
              className="inline-flex min-h-11 items-center text-accent underline-offset-4 hover:underline"
            >
              Als versendet markieren
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
