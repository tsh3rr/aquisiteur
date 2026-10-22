import { FileSignature, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { OFFER_STATUS_LABELS, OFFER_STATUS_TONES } from "@/domain/offers/schema";
import { formatCents } from "@/domain/offers/totals";
import { listOffers } from "@/server/offers/manage";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../chat/live-refresh";

export const metadata: Metadata = { title: "Angebote" };

const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Berlin" });

function amount(onceCents: number, monthlyCents: number) {
  const parts = [];
  if (onceCents > 0) parts.push(formatCents(onceCents));
  if (monthlyCents > 0) parts.push(`${formatCents(monthlyCents)} / Monat`);
  return parts.join(" + ") || "–";
}

export default async function OffersPage() {
  const { workspace, tenant } = await requireCockpit();
  const rows = await tenant((tx) => listOffers(tx, workspace.id));
  const open = rows.filter((row) => row.status === "sent");
  const openCents = open.reduce((sum, row) => sum + row.onceCents, 0);

  return (
    <div className="grid gap-8">
      <LiveRefresh events={["offer.changed"]} />
      <PageHeader
        title="Angebote"
        description={
          open.length > 0
            ? `${open.length} offen, zusammen ${formatCents(openCents)} einmalig.`
            : "Angebote entstehen in einem Projekt auf der Kundenseite."
        }
      />
      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <FileSignature aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">Noch keine Angebote.</p>
              <p className="text-sm text-foreground-muted">
                Öffnen Sie einen Kunden, legen Sie dort ein Projekt an und erstellen Sie darin das
                Angebot. Es lässt sich online annehmen und füllt auf Wunsch die Preise im Exposé.
              </p>
            </div>
            <Link
              href="/kunden"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken"
            >
              <Users aria-hidden className="size-4" />
              Zu den Kunden
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="relative overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">Alle Angebote</caption>
            <thead className="border-b border-border text-foreground-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Angebot
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Kunde und Projekt
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Summe
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Gültig bis
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/angebote/${row.id}`}
                      className="grid font-medium hover:text-accent"
                    >
                      {row.title || "Ohne Titel"}
                      <span className="font-normal text-foreground-muted">
                        {row.number ?? "Entwurf"}
                        {row.version && row.version > 1 ? ` · Version ${row.version}` : ""}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Link href={`/kunden/${row.prospectId}`} className="grid hover:text-accent">
                      {row.company}
                      <span className="text-foreground-muted">{row.projectName}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className="grid justify-items-start gap-1">
                      <Badge tone={OFFER_STATUS_TONES[row.status]}>
                        {OFFER_STATUS_LABELS[row.status]}
                      </Badge>
                      {row.status === "sent" ? (
                        <span className="text-xs text-foreground-muted">
                          {row.viewCount > 0 ? `${row.viewCount}× geöffnet` : "noch nicht geöffnet"}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">
                    {amount(row.onceCents, row.monthlyCents)}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {row.validUntil ? day.format(new Date(row.validUntil)) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
