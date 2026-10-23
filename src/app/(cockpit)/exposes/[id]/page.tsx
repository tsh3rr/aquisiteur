import { eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { workspaces } from "@/db/schema";
import { can } from "@/domain/authz";
import { exposeExpiry } from "@/server/exposes/expiry";
import { getExposeDetail } from "@/server/exposes/list";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { ExposePdfButton } from "@/components/expose-pdf/pdf-button";
import { loadExposePdf, resetExposeExpiry, setExposeOnline } from "./actions";
import { PreviewFrame } from "./preview-frame";

export const metadata: Metadata = { title: "Exposé" };

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const date = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" });
const sourceLabel = { api: "CLI/API", cockpit: "Cockpit", seed: "Beispieldaten" } as const;

export default async function ExposeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string; variant?: string }>;
}) {
  const { id } = await params;
  const { version, variant } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const result = await tenant(async (tx) => {
    const detail = await getExposeDetail(tx, workspace.id, id);
    if (!detail) return null;
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    return {
      ...detail,
      origin: await workspacePublicOrigin(tx, ws!),
      expiry: await exposeExpiry(tx, workspace.id, id, settings.exposeExpiry),
      expiryDays: settings.exposeExpiry.afterDays,
    };
  });
  if (!result) notFound();
  const { expose, versions, origin, expiry, expiryDays } = result;
  const short = variant === "expired";
  const canManage = can(actor, "exposes.manage", { workspaceId: workspace.id });
  const shown = versions.find((v) => String(v.version) === version) ?? versions[0];
  const publicUrl = `${origin}/x/${expose.slug}`;
  const online = !expose.unpublishedAt;

  return (
    <div className="grid gap-8">
      <PageHeader
        title={expose.company}
        description={expose.title}
        actions={
          online ? (
            <Button asChild variant="secondary">
              <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden />
                Öffentlich ansehen
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="preview-title" className="grid content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="preview-title" className="text-lg font-semibold">
              Vorschau{shown ? ` · Version ${shown.version}` : ""}
              {short ? " · Kurzseite" : ""}
            </h2>
            {shown ? (
              <nav aria-label="Ansicht der Vorschau" className="flex gap-1 text-sm">
                {(
                  [
                    ["full", "Exposé"],
                    ["expired", "Kurzseite nach Ablauf"],
                  ] as const
                ).map(([key, label]) => (
                  <a
                    key={key}
                    href={`/exposes/${expose.id}?version=${shown.version}${key === "expired" ? "&variant=expired" : ""}`}
                    aria-current={(key === "expired") === short ? "page" : undefined}
                    className="flex min-h-11 items-center rounded-md px-3 hover:bg-surface-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-soft-foreground"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>
          {shown ? (
            <PreviewFrame
              src={`/preview/${expose.id}?version=${shown.version}${short ? "&variant=expired" : ""}`}
              title={`Vorschau ${expose.company}, Version ${shown.version}${short ? ", Kurzseite" : ""}`}
            />
          ) : (
            <p className="text-foreground-muted">Noch keine Version.</p>
          )}
        </section>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                {!online
                  ? "Der Link zeigt eine Fehlerseite."
                  : expiry.expired
                    ? "Abgelaufen: Der Link zeigt nur noch die Kurzseite mit Vorher-nachher, Ihren Ideen als Stichpunkten und allen Kontaktwegen."
                    : "Das Exposé ist unter seinem Link erreichbar."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {!online ? (
                  <Badge tone="warning">Offline</Badge>
                ) : expiry.expired ? (
                  <Badge tone="warning">Abgelaufen</Badge>
                ) : (
                  <Badge tone="success">Online</Badge>
                )}
                {expose.doNotContactAt ? <Badge tone="danger">Kein Interesse</Badge> : null}
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="grid gap-0.5">
                  <dt className="text-foreground-muted">Link</dt>
                  <dd className="font-mono break-all">{publicUrl}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-foreground-muted">Ablauf</dt>
                  <dd>
                    {!expiry.expiresAt ? (
                      <>
                        Aus, siehe{" "}
                        <a href="/settings#exposes" className="underline underline-offset-4">
                          Einstellungen
                        </a>
                      </>
                    ) : expiry.expired ? (
                      `Seit ${date.format(expiry.expiresAt)}, ${expiryDays} Tage nach dem letzten Aufruf, Brief oder Veröffentlichen`
                    ) : (
                      `Am ${date.format(expiry.expiresAt)}, wenn bis dahin niemand das Exposé öffnet und kein Brief hinausgeht`
                    )}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-foreground-muted">Referenz</dt>
                  <dd className="font-mono">{expose.refCode}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-foreground-muted">Prospect-Schlüssel</dt>
                  <dd className="font-mono">{expose.prospectKey}</dd>
                </div>
              </dl>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {online && expiry.expired ? (
                    <form action={resetExposeExpiry}>
                      <input type="hidden" name="id" value={expose.id} />
                      <Button type="submit" size="sm">
                        Wieder voll anzeigen
                      </Button>
                    </form>
                  ) : null}
                  <form action={setExposeOnline}>
                    <input type="hidden" name="id" value={expose.id} />
                    <input type="hidden" name="online" value={online ? "0" : "1"} />
                    <Button type="submit" variant="secondary" size="sm">
                      {online ? "Offline nehmen" : "Wieder online stellen"}
                    </Button>
                  </form>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {shown ? (
            <Card>
              <CardHeader>
                <CardTitle>PDF</CardTitle>
                <CardDescription>
                  Gestaltete Fassung von Version {shown.version}, etwa als Beilage zum Brief. Mit
                  QR-Code zum Exposé, solange es online ist.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ExposePdfButton load={loadExposePdf.bind(null, expose.id, shown.version)} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Versionen</CardTitle>
              <CardDescription>Alte Versionen bleiben erhalten.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-1">
                {versions.map((v) => (
                  <li key={v.id}>
                    <a
                      href={`/exposes/${expose.id}?version=${v.version}`}
                      aria-current={v.id === shown?.id ? "true" : undefined}
                      className="grid rounded-md px-3 py-2 text-sm hover:bg-surface-sunken aria-[current=true]:bg-accent-soft aria-[current=true]:text-accent-soft-foreground"
                    >
                      <span className="font-medium">
                        Version {v.version}
                        {v.id === expose.currentVersionId ? " · aktuell" : ""}
                      </span>
                      <span className="text-foreground-muted">
                        {dateTime.format(v.createdAt)} · {sourceLabel[v.source]}
                        {v.publishedBy ? ` · ${v.publishedBy}` : ""}
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
