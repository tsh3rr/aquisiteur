"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { LetterPdfButton } from "@/components/letters/pdf-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  formatTimeToOpen,
  LETTER_STATUS_LABELS,
  LETTER_STATUS_TONES,
  type LetterKind,
  type LetterStatus,
} from "@/domain/letters/lifecycle";
import {
  cancelLettersAction,
  markPostedAction,
  markReturnedAction,
  printableLettersAction,
  type BulkState,
} from "./actions";

export interface LetterRow {
  id: string;
  prospectId: string;
  companyName: string;
  campaignId: string | null;
  kind: LetterKind;
  status: LetterStatus;
  shortCode: string | null;
  postedAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const checkbox = "size-5 accent-accent";

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Letters with bulk actions: PDF, mark posted/returned, discard (§7.9). */
export function LetterTable({
  rows,
  canManage,
  preselected,
  campaigns,
}: {
  rows: LetterRow[];
  canManage: boolean;
  preselected: string[];
  campaigns: Record<string, string>;
}) {
  const [selected, setSelected] = useState(() => new Set(preselected));
  const [postedOn, setPostedOn] = useState(today);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const chosen = ids.filter((id) => selected.has(id));
  const allSelected = chosen.length === ids.length && ids.length > 0;

  const run = (action: () => Promise<BulkState>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      if (result.ok) setSelected(new Set());
    });
  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid gap-3">
      {canManage ? (
        <div
          role="group"
          aria-label="Sammelaktionen"
          className="grid gap-3 rounded-lg border border-border bg-surface-sunken/60 px-4 py-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium tabular-nums">{chosen.length} ausgewählt</span>
            <LetterPdfButton
              ids={chosen}
              load={printableLettersAction}
              filename={chosen.length === 1 ? "brief.pdf" : `briefe-${chosen.length}.pdf`}
              variant="primary"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="letters-posted-on" className="grid gap-1 text-sm">
              Versanddatum
              <Input
                id="letters-posted-on"
                type="date"
                value={postedOn}
                max={today()}
                onChange={(event) => setPostedOn(event.target.value)}
                className="w-auto"
              />
            </label>
            <Button
              variant="secondary"
              disabled={chosen.length === 0 || pending}
              onClick={() => run(() => markPostedAction(chosen, postedOn))}
            >
              Als versendet markieren
            </Button>
            <Button
              variant="secondary"
              disabled={chosen.length === 0 || pending}
              onClick={() => run(() => markReturnedAction(chosen))}
            >
              Zurückgekommen
            </Button>
            <Button
              variant="secondary"
              disabled={chosen.length === 0 || pending}
              onClick={() => run(() => cancelLettersAction(chosen))}
            >
              Verwerfen
            </Button>
          </div>
          <p aria-live="polite" className="text-sm text-foreground-muted">
            {message}
          </p>
        </div>
      ) : null}
      <Card
        className="relative overflow-x-auto"
        role="region"
        aria-label="Brieftabelle, seitlich scrollbar"
        tabIndex={0}
      >
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">Briefe</caption>
          <thead className="border-b border-border text-foreground-muted">
            <tr>
              {canManage ? (
                <th scope="col" className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Alle auswählen"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(ids))}
                    className={checkbox}
                  />
                </th>
              ) : null}
              <th scope="col" className="px-4 py-3 font-medium">
                Kunde
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Art
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Kampagne
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Versendet
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Geöffnet
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-sunken/50">
                {canManage ? (
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Brief an ${row.companyName} auswählen`}
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className={checkbox}
                    />
                  </td>
                ) : null}
                <th scope="row" className="px-4 py-2 font-medium">
                  <Link
                    href={`/kunden/${row.prospectId}`}
                    className="inline-flex min-h-11 items-center hover:text-accent"
                  >
                    {row.companyName}
                  </Link>
                </th>
                <td className="px-4 py-2">
                  <Badge tone={LETTER_STATUS_TONES[row.status]}>
                    {LETTER_STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  {row.kind === "initial" ? "Erster Brief" : "Folgebrief"}
                  {row.shortCode ? (
                    <span className="block font-mono text-xs text-foreground-muted">
                      /{row.shortCode}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  {row.campaignId ? (campaigns[row.campaignId] ?? "–") : "–"}
                </td>
                <td className="px-4 py-2">
                  {row.postedAt ? day.format(new Date(row.postedAt)) : "–"}
                </td>
                <td className="px-4 py-2">
                  {row.openedAt && row.postedAt ? (
                    <>
                      {day.format(new Date(row.openedAt))}
                      <span className="block text-xs text-foreground-muted">
                        nach {formatTimeToOpen(new Date(row.postedAt), new Date(row.openedAt))}
                      </span>
                    </>
                  ) : row.postedAt ? (
                    <span className="text-foreground-muted">Noch nicht</span>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
