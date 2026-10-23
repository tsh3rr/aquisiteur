import { ArrowLeft, Repeat } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  CONTRACT_STATE_LABELS,
  CONTRACT_STATE_TONES,
  INTERVAL_PERIOD_LABELS,
} from "@/domain/invoices/maintenance";
import { germanDate } from "@/domain/invoices/totals";
import { formatCents } from "@/domain/offers/totals";
import { listContracts } from "@/server/invoices/contracts";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../chat/live-refresh";

export const metadata: Metadata = { title: "Wartungsverträge" };

export default async function ContractsPage() {
  const { workspace, tenant } = await requireCockpit();
  const contracts = await tenant((tx) => listContracts(tx, workspace.id));
  const running = contracts.filter((contract) => contract.state !== "ended");

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["invoice.changed"]} />
      <Link
        href="/rechnungen"
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Rechnungen
      </Link>
      <PageHeader
        title="Wartungsverträge"
        description={
          running.length > 0
            ? `${running.length} laufend. Der stündliche Job legt jede fällige Rechnung an.`
            : "Wartungsverträge entstehen aus den wiederkehrenden Positionen angenommener Angebote."
        }
      />
      {contracts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Repeat aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">Noch keine Wartungsverträge.</p>
              <p className="text-sm text-foreground-muted">
                Hat ein angenommenes Angebot monatliche oder jährliche Positionen, legt
                „Wartungsvertrag anlegen“ im Angebot den Vertrag an.
              </p>
            </div>
            <Link
              href="/kunden"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Zu den Kunden
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="relative overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Wartungsverträge</caption>
            <thead className="border-b border-border text-foreground-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Vertrag
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Netto pro Zeitraum
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Nächste Rechnung
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contracts.map((contract) => (
                <tr key={contract.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/rechnungen/vertraege/${contract.id}`}
                      className="grid font-medium hover:text-accent"
                    >
                      {contract.title}
                      <span className="font-normal text-foreground-muted">
                        {[contract.companyName, contract.projectName].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={CONTRACT_STATE_TONES[contract.state]}>
                      {CONTRACT_STATE_LABELS[contract.state]}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {formatCents(contract.periodNetCents)} /{" "}
                    {INTERVAL_PERIOD_LABELS[contract.interval]}
                  </td>
                  <td className="px-5 py-3">
                    {contract.nextBilling
                      ? germanDate(contract.nextBilling)
                      : contract.state === "pending"
                        ? "nach Eintrag des Beginns"
                        : "–"}
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
