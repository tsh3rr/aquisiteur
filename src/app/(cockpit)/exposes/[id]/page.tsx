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
import { getExposeDetail } from "@/server/exposes/list";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";
import { setExposeOnline } from "./actions";
import { PreviewFrame } from "./preview-frame";

export const metadata: Metadata = { title: "Exposé" };

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const sourceLabel = { api: "CLI/API", cockpit: "Cockpit", seed: "Beispieldaten" } as const;

export default async function ExposeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params;
  const { version } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const result = await tenant(async (tx) => {
    const detail = await getExposeDetail(tx, workspace.id, id);
    if (!detail) return null;
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    return { ...detail, origin: await workspacePublicOrigin(tx, ws!) };
  });
  if (!result) notFound();
  const { expose, versions, origin } = result;
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
          <h2 id="preview-title" className="text-lg font-semibold">
            Vorschau{shown ? ` · Version ${shown.version}` : ""}
          </h2>
          {shown ? (
            <PreviewFrame
              src={`/preview/${expose.id}?version=${shown.version}`}
              title={`Vorschau ${expose.company}, Version ${shown.version}`}
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
                {online
                  ? "Das Exposé ist unter seinem Link erreichbar."
                  : "Der Link zeigt eine Fehlerseite."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {online ? (
                  <Badge tone="success">Online</Badge>
                ) : (
                  <Badge tone="warning">Offline</Badge>
                )}
                {expose.doNotContactAt ? <Badge tone="danger">Kein Interesse</Badge> : null}
              </div>
              <dl className="grid gap-3 text-sm">
                <div className="grid gap-0.5">
                  <dt className="text-foreground-muted">Link</dt>
                  <dd className="font-mono break-all">{publicUrl}</dd>
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
              {can(actor, "exposes.manage", { workspaceId: workspace.id }) ? (
                <form action={setExposeOnline}>
                  <input type="hidden" name="id" value={expose.id} />
                  <input type="hidden" name="online" value={online ? "0" : "1"} />
                  <Button type="submit" variant="secondary" size="sm">
                    {online ? "Offline nehmen" : "Wieder online stellen"}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

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
