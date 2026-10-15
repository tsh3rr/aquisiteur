import { eq } from "drizzle-orm";
import { FileText, KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { workspaces } from "@/db/schema";
import { listExposes } from "@/server/exposes/list";
import { workspacePublicOrigin } from "@/server/exposes/urls";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = { title: "Exposés" };

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export default async function ExposesPage() {
  const { workspace, tenant } = await requireCockpit();
  const { rows, origin } = await tenant(async (tx) => {
    const [ws] = await tx
      .select({ id: workspaces.id, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.id, workspace.id));
    return {
      rows: await listExposes(tx, workspace.id),
      origin: await workspacePublicOrigin(tx, ws!),
    };
  });

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Exposés"
        description="Persönliche Präsentationen, veröffentlicht per CLI oder API."
      />
      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <FileText aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">Noch keine Exposés.</p>
              <p className="text-sm text-foreground-muted">
                Legen Sie einen API-Token an und veröffentlichen Sie ein Exposé mit{" "}
                <code className="font-mono">pnpm expose:publish exposes/&lt;ordner&gt;</code>.
              </p>
            </div>
            <Link
              href="/settings#api-tokens"
              className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-sunken"
            >
              <KeyRound aria-hidden className="size-4" />
              API-Token anlegen
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Alle Exposés</caption>
            <thead className="border-b border-border text-foreground-muted">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Kunde
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Version
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Aktualisiert
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  <span className="sr-only">Öffentlicher Link</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-5 py-3">
                    <Link
                      href={`/exposes/${row.id}`}
                      className="grid font-medium hover:text-accent"
                    >
                      {row.company}
                      <span className="font-normal text-foreground-muted">{row.title}</span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 tabular-nums">v{row.version ?? "–"}</td>
                  <td className="px-5 py-3">
                    {row.unpublishedAt ? (
                      <Badge tone="warning">Offline</Badge>
                    ) : (
                      <Badge tone="success">Online</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-foreground-muted">
                    {dateTime.format(row.updatedAt)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {row.unpublishedAt ? null : (
                      <a
                        href={`${origin}/x/${row.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline-offset-4 hover:underline"
                      >
                        Öffnen<span className="sr-only"> (neuer Tab): {row.company}</span>
                      </a>
                    )}
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
