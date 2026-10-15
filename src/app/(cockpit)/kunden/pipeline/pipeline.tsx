"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition, type DragEvent } from "react";
import { Select } from "@/components/ui/input";
import { PROSPECT_STATUSES, STATUS_LABELS, type ProspectStatus } from "@/domain/prospects/status";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/relative-time";
import { changeStatus } from "../actions";

interface PipelineCard {
  id: string;
  companyName: string;
  city: string | null;
  status: ProspectStatus;
  lastActivityAt: string | null;
}

const MIME = "application/x-aquisiteur-prospect";

/**
 * Kanban of the status pipeline (§7.1). Drag and drop for the pointer; the
 * status select on every card is the keyboard and screen-reader way.
 */
export function Pipeline({ cards, canManage }: { cards: PipelineCard[]; canManage: boolean }) {
  const [optimistic, move] = useOptimistic(
    cards,
    (state, change: { id: string; status: ProspectStatus }) =>
      state.map((card) => (card.id === change.id ? { ...card, status: change.status } : card)),
  );
  const [, startTransition] = useTransition();
  const [over, setOver] = useState<ProspectStatus | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const update = (card: PipelineCard, status: ProspectStatus) => {
    if (card.status === status) return;
    startTransition(async () => {
      move({ id: card.id, status });
      const result = await changeStatus([card.id], status);
      setAnnouncement(
        result.ok
          ? `${card.companyName}: ${STATUS_LABELS[status]}.`
          : (result.message ?? "Status konnte nicht geändert werden."),
      );
    });
  };

  const onDrop = (event: DragEvent, status: ProspectStatus) => {
    event.preventDefault();
    setOver(null);
    const card = optimistic.find((entry) => entry.id === event.dataTransfer.getData(MIME));
    if (card) update(card, status);
  };

  return (
    <>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <ol className="flex w-max gap-4">
          {PROSPECT_STATUSES.map((status) => {
            const column = optimistic.filter((card) => card.status === status);
            return (
              // Drag and drop is a pointer shortcut; the status select on each card is the accessible way.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <li
                key={status}
                aria-labelledby={`column-${status}`}
                onDragOver={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver((current) => (current === status ? null : current))}
                onDrop={(event) => onDrop(event, status)}
                className={cn(
                  "grid w-72 content-start gap-3 rounded-lg border border-border bg-surface-sunken/60 p-3 transition-colors",
                  over === status && "border-accent bg-accent-soft",
                )}
              >
                <h2
                  id={`column-${status}`}
                  className="flex items-center justify-between px-1 text-sm font-semibold"
                >
                  {STATUS_LABELS[status]}
                  <span className="text-foreground-muted tabular-nums">{column.length}</span>
                </h2>
                <ul className="grid gap-2">
                  {column.map((card) => (
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                    <li
                      key={card.id}
                      draggable={canManage}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(MIME, card.id);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      className={cn(
                        "grid gap-2 rounded-md border border-border bg-surface p-3 shadow-sm",
                        canManage && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <Link
                        href={`/kunden/${card.id}`}
                        className="font-medium hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        {card.companyName}
                      </Link>
                      <p className="text-xs text-foreground-muted">
                        {[
                          card.city,
                          card.lastActivityAt
                            ? `aktiv ${formatRelative(new Date(card.lastActivityAt))}`
                            : "noch nicht geöffnet",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {canManage ? (
                        <Select
                          aria-label={`Status von ${card.companyName}`}
                          value={card.status}
                          onChange={(event) => update(card, event.target.value as ProspectStatus)}
                          className="h-11"
                        >
                          {PROSPECT_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {STATUS_LABELS[value]}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {column.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-foreground-muted">
                    Keine Kunden
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
