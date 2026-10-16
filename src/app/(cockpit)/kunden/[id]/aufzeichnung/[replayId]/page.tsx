import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { prospects, sessionReplays, visits } from "@/db/schema";
import { can } from "@/domain/authz";
import { formatSeconds } from "@/domain/analytics/format";
import { requireCockpit } from "@/server/session";
import { deleteReplayAction } from "./actions";
import { ReplayPlayer } from "./player";

export const metadata: Metadata = { title: "Aufzeichnung" };

const dateTime = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Berlin",
});

const DEVICE = { mobile: "Smartphone", tablet: "Tablet", desktop: "Computer", unknown: "Gerät" };

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ id: string; replayId: string }>;
}) {
  const { id, replayId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(replayId)) notFound();
  const { workspace, actor, tenant } = await requireCockpit();
  const [row] = await tenant((tx) =>
    tx
      .select({
        company: prospects.companyName,
        startedAt: sessionReplays.startedAt,
        durationMs: sessionReplays.durationMs,
        device: visits.device,
      })
      .from(sessionReplays)
      .innerJoin(
        prospects,
        and(
          eq(prospects.workspaceId, sessionReplays.workspaceId),
          eq(prospects.id, sessionReplays.prospectId),
        ),
      )
      .innerJoin(
        visits,
        and(
          eq(visits.workspaceId, sessionReplays.workspaceId),
          eq(visits.id, sessionReplays.visitId),
        ),
      )
      .where(
        and(
          eq(sessionReplays.workspaceId, workspace.id),
          eq(sessionReplays.id, replayId),
          eq(sessionReplays.prospectId, id),
        ),
      ),
  );
  if (!row) notFound();
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });

  return (
    <div className="grid gap-6">
      <nav aria-label="Brotkrumen" className="text-sm">
        <Link href={`/kunden/${id}`} className="text-accent underline-offset-4 hover:underline">
          {row.company}
        </Link>
      </nav>
      <PageHeader
        title="Aufzeichnung des Besuchs"
        description={`${dateTime.format(row.startedAt)} · ${DEVICE[row.device]} · Dauer ${formatSeconds(row.durationMs / 1000)} · Aufgezeichnet mit Einwilligung; Eingaben und Chat sind ausgeblendet.`}
        actions={
          canManage ? (
            <form action={deleteReplayAction.bind(null, id, replayId)}>
              <Button type="submit" variant="ghost">
                <Trash2 aria-hidden />
                Löschen
              </Button>
            </form>
          ) : undefined
        }
      />
      <Card>
        <CardContent>
          <ReplayPlayer src={`/kunden/${id}/aufzeichnung/${replayId}/daten`} />
        </CardContent>
      </Card>
    </div>
  );
}
