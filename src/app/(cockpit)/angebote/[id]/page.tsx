import { and, count, eq } from "drizzle-orm";
import { ArrowLeft, Copy, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exposes, workspaces } from "@/db/schema";
import { can } from "@/domain/authz";
import { taxNote } from "@/domain/billing";
import { BILLING_LABELS, OFFER_STATUS_LABELS, OFFER_STATUS_TONES } from "@/domain/offers/schema";
import { formatCents } from "@/domain/offers/totals";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { listCatalog, loadOffer } from "@/server/offers/manage";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../chat/live-refresh";
import { deleteOfferAction, duplicateOfferAction } from "../actions";
import { OfferEditor } from "./offer-editor";

type Params = Promise<{ id: string }>;

export const metadata: Metadata = { title: "Angebot" };

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});
const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });

const action =
  "inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export default async function OfferPage({ params }: { params: Params }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const loaded = await tenant(async (tx) => {
    const offer = await loadOffer(tx, workspace.id, id);
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    if (!offer || !ws) return null;
    const [exposeCount] = await tx
      .select({ count: count() })
      .from(exposes)
      .where(and(eq(exposes.workspaceId, workspace.id), eq(exposes.projectId, offer.projectId)));
    return {
      offer,
      origin: await workspacePublicOrigin(tx, ws),
      catalog: await listCatalog(tx, workspace.id),
      hasExpose: (exposeCount?.count ?? 0) > 0,
    };
  });
  if (!loaded) notFound();
  const { offer, origin, catalog, hasExpose } = loaded;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const editable = canManage && offer.status !== "accepted" && offer.status !== "withdrawn";
  const acceptance = offer.acceptance;

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["offer.changed"]} prospectId={offer.prospectId} />
      <Link
        href={`/projekte/${offer.projectId}`}
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {offer.company} · {offer.projectName}
      </Link>

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{offer.title || "Angebot ohne Titel"}</h1>
          <Badge tone={OFFER_STATUS_TONES[offer.displayStatus]}>
            {OFFER_STATUS_LABELS[offer.displayStatus]}
          </Badge>
        </div>
        <p className="text-foreground-muted">
          {[
            offer.number ?? "Noch ohne Nummer",
            offer.current ? `Version ${offer.current.version}` : null,
            offer.current ? `gültig bis ${day.format(new Date(offer.current.validUntil))}` : null,
            offer.viewCount > 0
              ? `${offer.viewCount}× geöffnet, zuletzt ${dateTime.format(offer.lastViewedAt!)}`
              : offer.sentAt
                ? "noch nicht geöffnet"
                : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {offer.changedSinceSent && offer.status === "sent" ? (
          <p className="text-sm text-warning-foreground" role="status">
            Der Entwurf weicht von der versendeten Version ab. Erst „Neue Version senden“ macht die
            Änderungen für den Kunden sichtbar.
          </p>
        ) : null}
      </header>

      {acceptance ? (
        <Card aria-labelledby="acceptance-heading">
          <CardHeader>
            <CardTitle id="acceptance-heading">Angenommen</CardTitle>
            <CardDescription>
              Am {dateTime.format(new Date(acceptance.acceptedAt))} von {acceptance.name}
              {acceptance.role ? ` (${acceptance.role})` : ""}, Version {acceptance.version}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {acceptance.variantTitle ? <p>Variante: {acceptance.variantTitle}</p> : null}
            <p>
              Einmalig:{" "}
              <span className="font-medium">{formatCents(acceptance.onceTotalCents)}</span>
              {acceptance.recurring.map((entry) => (
                <span key={entry.interval}>
                  {" · "}
                  {BILLING_LABELS[entry.interval as keyof typeof BILLING_LABELS]}:{" "}
                  <span className="font-medium">{formatCents(entry.totalCents)}</span>
                </span>
              ))}
            </p>
            <p className="text-foreground-muted">
              Prüfsumme der angenommenen Fassung:{" "}
              <code className="font-mono break-all">{acceptance.sha256}</code>
            </p>
          </CardContent>
        </Card>
      ) : null}

      {offer.status === "declined" ? (
        <Card>
          <CardHeader>
            <CardTitle>Abgelehnt</CardTitle>
            <CardDescription>
              {offer.answeredAt ? `Am ${dateTime.format(offer.answeredAt)}. ` : ""}
              {offer.declineReason
                ? `Begründung: „${offer.declineReason}“`
                : "Ohne Begründung."}{" "}
              Sie können das Angebot überarbeiten und als neue Version senden.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <OfferEditor
        offerId={offer.id}
        initial={offer.draft}
        taxMode={offer.billing.taxMode}
        taxNote={taxNote(offer.billing)}
        editable={editable}
        sent={offer.status === "sent" || offer.status === "declined"}
        publicUrl={offer.publicToken && offer.current ? `${origin}/a/${offer.publicToken}` : null}
        hasExpose={hasExpose}
        catalog={catalog.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          unit: item.unit,
          unitPriceCents: item.unitPriceCents,
          billing: item.billing,
          vatRate: item.vatRate,
        }))}
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Versionen</CardTitle>
            <CardDescription>
              Jede versendete Fassung bleibt unverändert gespeichert, mit Prüfsumme.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {offer.versions.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                Noch nicht versendet. Mit „Angebot fertigstellen“ entsteht Version 1 und der Link
                für den Kunden.
              </p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {offer.versions.map((version) => (
                  <li key={version.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">
                      Version {version.version}
                      {version.id === offer.currentVersionId ? " (aktuell)" : ""}
                    </span>
                    <span className="text-foreground-muted">
                      {dateTime.format(version.createdAt)} · gültig bis{" "}
                      {day.format(new Date(version.validUntil))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Weitere Aktionen</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form action={duplicateOfferAction}>
                <input type="hidden" name="id" value={offer.id} />
                <button type="submit" className={action}>
                  <Copy aria-hidden className="size-4" />
                  Als neues Angebot kopieren
                </button>
              </form>
              {offer.status === "draft" ? (
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-danger">
                    Entwurf löschen …
                  </summary>
                  <form action={deleteOfferAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="id" value={offer.id} />
                    <p className="text-sm">Diesen Entwurf endgültig löschen?</p>
                    <button
                      type="submit"
                      className="inline-flex h-11 items-center gap-2 justify-self-start rounded-md bg-danger px-4 text-sm font-medium text-danger-foreground hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <Trash2 aria-hidden className="size-4" />
                      Endgültig löschen
                    </button>
                  </form>
                </details>
              ) : (
                <p className="text-sm text-foreground-muted">
                  Versendete Angebote bleiben zur Nachvollziehbarkeit erhalten. Ziehen Sie sie
                  stattdessen zurück.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
