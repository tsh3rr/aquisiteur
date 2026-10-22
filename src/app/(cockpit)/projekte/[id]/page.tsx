import { ArrowLeft, FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { can } from "@/domain/authz";
import { BILLING_LABELS, OFFER_STATUS_LABELS, OFFER_STATUS_TONES } from "@/domain/offers/schema";
import { formatCents } from "@/domain/offers/totals";
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_TONES } from "@/domain/projects";
import { listCatalog, listOffers } from "@/server/offers/manage";
import { loadProject } from "@/server/projects";
import { requireCockpit } from "@/server/session";
import { LiveRefresh } from "../../chat/live-refresh";
import { createOfferAction, deleteProjectAction } from "../actions";
import { EditProjectForm } from "../project-forms";

type Params = Promise<{ id: string }>;
type Search = Promise<{ fehler?: string }>;

export const metadata: Metadata = { title: "Projekt" };

const day = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "Europe/Berlin" });

const primary =
  "inline-flex h-11 items-center gap-2 justify-self-start rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { fehler } = await searchParams;
  const { workspace, actor, tenant } = await requireCockpit();
  const loaded = await tenant(async (tx) => {
    const project = await loadProject(tx, workspace.id, id);
    if (!project) return null;
    return {
      project,
      offers: await listOffers(tx, workspace.id, { projectId: id }),
      catalog: await listCatalog(tx, workspace.id),
    };
  });
  if (!loaded) notFound();
  const { project, offers, catalog } = loaded;
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });

  return (
    <div className="grid gap-6">
      <LiveRefresh events={["offer.changed"]} prospectId={project.prospectId} />
      <Link
        href={`/kunden/${project.prospectId}`}
        className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm text-foreground-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {project.company}
      </Link>

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <Badge tone={PROJECT_STATUS_TONES[project.status]}>
            {PROJECT_STATUS_LABELS[project.status]}
          </Badge>
        </div>
        {project.description ? (
          <p className="max-w-prose text-foreground-muted">{project.description}</p>
        ) : null}
      </header>

      {fehler === "in_use" ? (
        <Alert tone="warning">
          Das Projekt hat ein Exposé oder ein versendetes Angebot und bleibt deshalb erhalten.
        </Alert>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-5">
        <div className="grid min-w-0 gap-6 xl:col-span-3">
          <Card aria-labelledby="offers-heading">
            <CardHeader>
              <CardTitle id="offers-heading">Angebote</CardTitle>
              <CardDescription>
                Das angenommene, sonst das zuletzt versendete Angebot liefert die Preise fürs
                Exposé.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              {offers.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  Noch kein Angebot. Starten Sie leer oder mit Leistungen aus Ihrem Katalog.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {offers.map((offer) => (
                    <li key={offer.id}>
                      <Link
                        href={`/angebote/${offer.id}`}
                        className="grid gap-1 rounded-lg border border-border p-3 text-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">{offer.title || "Ohne Titel"}</span>
                          <Badge tone={OFFER_STATUS_TONES[offer.status]}>
                            {OFFER_STATUS_LABELS[offer.status]}
                          </Badge>
                        </span>
                        <span className="text-foreground-muted">
                          {[
                            offer.number ?? "Entwurf",
                            offer.onceCents > 0 ? formatCents(offer.onceCents) : null,
                            offer.monthlyCents > 0
                              ? `${formatCents(offer.monthlyCents)} ${BILLING_LABELS.monthly}`
                              : null,
                            offer.validUntil
                              ? `gültig bis ${day.format(new Date(offer.validUntil))}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <form action={createOfferAction} className="grid gap-4 border-t border-border pt-4">
                  <input type="hidden" name="projectId" value={project.id} />
                  <Field label="Titel des neuen Angebots" optional>
                    <Input name="title" maxLength={160} placeholder={project.name} />
                  </Field>
                  {catalog.length > 0 ? (
                    <fieldset className="grid gap-1">
                      <legend className="mb-1 text-sm font-medium">Leistungen übernehmen</legend>
                      {catalog.map((item) => (
                        <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm">
                          <input
                            type="checkbox"
                            name="catalogItemId"
                            value={item.id}
                            className="size-5 accent-accent"
                          />
                          <span>
                            {item.name}{" "}
                            <span className="text-foreground-muted">
                              · {formatCents(item.unitPriceCents)} {BILLING_LABELS[item.billing]}
                            </span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ) : (
                    <p className="text-sm text-foreground-muted">
                      Tipp: Wiederkehrende Leistungen legen Sie einmal im{" "}
                      <Link
                        href="/settings#leistungen"
                        className="text-accent underline underline-offset-4"
                      >
                        Leistungskatalog
                      </Link>{" "}
                      an.
                    </p>
                  )}
                  <button type="submit" className={primary}>
                    <Plus aria-hidden className="size-4" />
                    Angebot erstellen
                  </button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Exposés</CardTitle>
            </CardHeader>
            <CardContent>
              {project.exposes.length === 0 ? (
                <p className="text-sm text-foreground-muted">
                  Noch kein Exposé. Veröffentlichen Sie eines für diesen Kunden, es wird dann dem
                  Projekt zugeordnet.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {project.exposes.map((expose) => (
                    <li key={expose.id}>
                      <Link
                        href={`/exposes/${expose.id}`}
                        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:text-accent"
                      >
                        <FileText aria-hidden className="size-4" />
                        {expose.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {canManage ? (
          <div className="grid min-w-0 gap-6 xl:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Projekt bearbeiten</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
                <EditProjectForm project={project} />
                <details>
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-danger">
                    Projekt löschen …
                  </summary>
                  <form action={deleteProjectAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="id" value={project.id} />
                    <p className="text-sm">
                      Nur möglich ohne Exposé und ohne versendetes Angebot. Entwürfe werden mit
                      gelöscht.
                    </p>
                    <button
                      type="submit"
                      className="inline-flex h-11 items-center justify-self-start rounded-md bg-danger px-4 text-sm font-medium text-danger-foreground hover:bg-danger-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      Endgültig löschen
                    </button>
                  </form>
                </details>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </div>
  );
}
