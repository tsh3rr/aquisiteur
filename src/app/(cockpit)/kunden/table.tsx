"use client";

import { Download, Mail } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { LEVEL_LABELS, type IntentLevel } from "@/domain/intent/score";
import { COLUMN_LABELS, type Column } from "@/domain/prospects/list-query";
import {
  PROSPECT_STATUSES,
  STATUS_LABELS,
  STATUS_TONES,
  type ProspectStatus,
} from "@/domain/prospects/status";
import { formatRelative } from "@/lib/relative-time";
import { assignCampaignAction, changeStatus } from "./actions";

export interface CustomerRow {
  id: string;
  companyName: string;
  city: string | null;
  status: ProspectStatus;
  tags: string[];
  createdAt: string;
  lastActivityAt: string | null;
  visitCount: number;
  score: number | null;
  level: IntentLevel | null;
  campaignId: string | null;
  campaignName: string | null;
}

const dateFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
const checkbox = "size-5 accent-accent";

function Cell({ column, row }: { column: Column; row: CustomerRow }) {
  switch (column) {
    case "status":
      return <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>;
    case "score":
      return row.score && row.level ? (
        <span className="grid">
          <span className="font-medium tabular-nums">{row.score} %</span>
          <span className="text-xs text-foreground-muted">{LEVEL_LABELS[row.level]}</span>
        </span>
      ) : (
        <span className="text-foreground-muted">–</span>
      );
    case "campaign":
      return row.campaignId ? (
        <Link href={`/kampagnen/${row.campaignId}`} className="hover:text-accent">
          {row.campaignName}
        </Link>
      ) : (
        <span className="text-foreground-muted">–</span>
      );
    case "city":
      return <>{row.city ?? "–"}</>;
    case "activity":
      return row.lastActivityAt ? (
        <time
          dateTime={row.lastActivityAt}
          title={new Date(row.lastActivityAt).toLocaleString("de-DE")}
        >
          {formatRelative(new Date(row.lastActivityAt))}
        </time>
      ) : (
        <span className="text-foreground-muted">Noch nicht geöffnet</span>
      );
    case "visits":
      return <span className="tabular-nums">{row.visitCount}</span>;
    case "tags":
      return row.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {row.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </span>
      ) : null;
    case "created":
      return <>{dateFormat.format(new Date(row.createdAt))}</>;
  }
}

/** The customer table with multi-select for bulk actions (§7.8). */
export function CustomerTable({
  rows,
  columns,
  canManage,
  campaigns,
}: {
  rows: CustomerRow[];
  columns: Column[];
  canManage: boolean;
  campaigns: { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<ProspectStatus>("letter_sent");
  const [campaign, setCampaign] = useState(campaigns[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => rows.map((row) => row.id), [rows]);
  const visibleSelected = ids.filter((id) => selected.has(id));
  const allSelected = visibleSelected.length === ids.length && ids.length > 0;

  const toggle = (id: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.message ?? "");
      if (result.ok) setSelected(new Set());
    });

  return (
    <div className="grid gap-3">
      {canManage ? (
        <div
          role="group"
          aria-label="Sammelaktionen"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-sunken/60 px-4 py-2"
        >
          <span className="text-sm font-medium tabular-nums">
            {visibleSelected.length} ausgewählt
          </span>
          <label className="flex items-center gap-2 text-sm">
            Status setzen auf
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as ProspectStatus)}
              className="h-11 w-auto"
            >
              {PROSPECT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </label>
          <Button
            variant="secondary"
            disabled={visibleSelected.length === 0 || pending}
            onClick={() => run(() => changeStatus(visibleSelected, status))}
          >
            Anwenden
          </Button>
          <label className="flex items-center gap-2 text-sm">
            Kampagne
            <Select
              value={campaign}
              onChange={(event) => setCampaign(event.target.value)}
              className="h-11 w-auto"
            >
              {campaigns.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
              <option value="">Keine Kampagne</option>
            </Select>
          </label>
          <Button
            variant="secondary"
            disabled={visibleSelected.length === 0 || pending}
            onClick={() => run(() => assignCampaignAction(visibleSelected, campaign))}
          >
            Zuweisen
          </Button>
          <Link
            href={
              visibleSelected.length
                ? `/briefe/neu?ids=${visibleSelected.join(",")}`
                : "/briefe/neu"
            }
            aria-disabled={visibleSelected.length === 0}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline aria-disabled:pointer-events-none aria-disabled:text-foreground-muted"
          >
            <Mail aria-hidden className="size-4" />
            Briefe erstellen
          </Link>
          <a
            href={
              visibleSelected.length ? `/kunden/export?ids=${visibleSelected.join(",")}` : undefined
            }
            aria-disabled={visibleSelected.length === 0}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent underline-offset-4 hover:underline aria-disabled:pointer-events-none aria-disabled:text-foreground-muted"
          >
            <Download aria-hidden className="size-4" />
            Auswahl als CSV
          </a>
          <p aria-live="polite" className="text-sm text-foreground-muted">
            {message}
          </p>
        </div>
      ) : null}
      <Card
        className="overflow-x-auto"
        role="region"
        aria-label="Kundentabelle, seitlich scrollbar"
        tabIndex={0}
      >
        <table className="w-full min-w-[40rem] text-left text-sm">
          <caption className="sr-only">Kunden</caption>
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
                Firma
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="px-4 py-3 font-medium">
                  {COLUMN_LABELS[column]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-sunken/50">
                {canManage ? (
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`${row.companyName} auswählen`}
                      checked={selected.has(row.id)}
                      onChange={() => toggle(row.id)}
                      className={checkbox}
                    />
                  </td>
                ) : null}
                <th scope="row" className="px-4 py-2 font-medium">
                  <Link
                    href={`/kunden/${row.id}`}
                    className="inline-flex min-h-11 items-center hover:text-accent"
                  >
                    {row.companyName}
                  </Link>
                </th>
                {columns.map((column) => (
                  <td key={column} className="px-4 py-2">
                    <Cell column={column} row={row} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
