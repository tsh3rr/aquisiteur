import { and, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { exposes, prospects } from "@/db/schema";
import { assertCan } from "@/domain/authz";
import { MAX_LETTERS_PER_BATCH } from "@/server/letters/manage";
import { requireCockpit } from "@/server/session";
import { NewLettersForm } from "./form";

export const metadata: Metadata = { title: "Briefe erstellen" };

export default async function NewLettersPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; kampagne?: string; art?: string }>;
}) {
  const { workspace, actor, tenant } = await requireCockpit();
  assertCan(actor, "prospects.manage", { workspaceId: workspace.id });
  const params = await searchParams;
  const ids = (params.ids ?? "")
    .split(",")
    .filter((id) => /^[0-9a-f-]{36}$/.test(id))
    .slice(0, MAX_LETTERS_PER_BATCH);
  const campaign = /^[0-9a-f-]{36}$/.test(params.kampagne ?? "") ? params.kampagne! : null;
  const rows =
    ids.length === 0 && !campaign
      ? []
      : await tenant((tx) =>
          tx
            .select({
              id: prospects.id,
              companyName: prospects.companyName,
              street: prospects.street,
              postalCode: prospects.postalCode,
              city: prospects.city,
              doNotContact: prospects.doNotContactAt,
              exposeId: exposes.currentVersionId,
              unpublishedAt: exposes.unpublishedAt,
            })
            .from(prospects)
            .leftJoin(
              exposes,
              and(
                eq(exposes.workspaceId, prospects.workspaceId),
                eq(exposes.prospectId, prospects.id),
              ),
            )
            .where(
              and(
                eq(prospects.workspaceId, workspace.id),
                campaign ? eq(prospects.campaignId, campaign) : inArray(prospects.id, ids),
              ),
            )
            .orderBy(prospects.companyName)
            .limit(MAX_LETTERS_PER_BATCH),
        );
  const issues = (row: (typeof rows)[number]) =>
    [
      row.doNotContact ? "„Kein Interesse“ gemeldet" : null,
      !row.exposeId || row.unpublishedAt ? "kein veröffentlichtes Exposé" : null,
      !row.street || !row.postalCode || !row.city ? "Anschrift unvollständig" : null,
    ].filter(Boolean) as string[];
  const ready = rows.filter((row) => !row.doNotContact && row.exposeId && !row.unpublishedAt);

  return (
    <div className="grid max-w-4xl gap-6">
      <PageHeader
        title="Briefe erstellen"
        description="Pro Kunde ein Brief mit QR-Code und Kurzlink. Sie prüfen das PDF, drucken selbst und markieren die Briefe danach als versendet."
      />
      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid gap-2 py-10 text-center">
            <p className="font-medium">Keine Kunden ausgewählt.</p>
            <p className="text-sm text-foreground-muted">
              Wählen Sie in der{" "}
              <Link href="/kunden" className="text-accent underline underline-offset-4">
                Kundenliste
              </Link>{" "}
              Kunden aus und klicken Sie auf „Briefe erstellen“.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                {ready.length} von {rows.length} {rows.length === 1 ? "Kunde" : "Kunden"} bereit
              </CardTitle>
              <CardDescription>
                Kunden ohne veröffentlichtes Exposé oder mit „Kein Interesse“ bekommen keinen Brief.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {rows.map((row) => {
                  const problems = issues(row);
                  return (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2 py-2">
                      <Link href={`/kunden/${row.id}`} className="font-medium hover:text-accent">
                        {row.companyName}
                      </Link>
                      <span
                        className={
                          problems.length ? "text-warning-foreground" : "text-foreground-muted"
                        }
                      >
                        {problems.length
                          ? problems.join(", ")
                          : [row.postalCode, row.city].join(" ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
          <NewLettersForm
            ids={ready.map((row) => row.id)}
            kind={params.art === "folgebrief" ? "follow_up" : "initial"}
          />
        </>
      )}
    </div>
  );
}
