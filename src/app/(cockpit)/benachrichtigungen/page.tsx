import { BellOff, Mail, Smartphone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { formatWhen } from "@/domain/intent/explain";
import { SUPPRESSED_LABELS, TRIGGER_LABELS, type Suppressed } from "@/domain/notifications";
import { listNotifications, markNotificationsRead } from "@/server/notifications/manage";
import { requireCockpit } from "@/server/session";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { LiveRefresh } from "../chat/live-refresh";
import { MarkedRead } from "./marked-read";

export const metadata: Metadata = { title: "Benachrichtigungen" };

/** Everything the owner was told, newest first (§7.7). Opening the list marks it read. */
export default async function NotificationsPage() {
  const { workspace, tenant } = await requireCockpit();
  const { items, timeZone } = await tenant(async (tx) => {
    const list = await listNotifications(tx, workspace.id, { limit: 100 });
    await markNotificationsRead(tx, workspace.id);
    const settings = await loadWorkspaceSettings(tx, workspace.id);
    return { items: list, timeZone: settings.notifications.timezone };
  });
  const now = new Date();

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Benachrichtigungen"
        description="Was Aquisiteur Ihnen gemeldet hat, auch in Ruhezeiten."
        actions={
          <Link
            href="/settings#benachrichtigungen"
            className="inline-flex h-11 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium shadow-sm hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            Regeln und Push einstellen
          </Link>
        }
      />
      <LiveRefresh events={["notification.created"]} />
      <MarkedRead />
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-3 py-14 text-center">
            <p className="font-medium">Noch keine Benachrichtigungen.</p>
            <p className="max-w-md text-sm text-foreground-muted">
              Sobald jemand ein Exposé öffnet, im Chat schreibt oder einen Rückruf wünscht, steht es
              hier. Aktivieren Sie Push, um es sofort auf dem Handy zu sehen.
            </p>
            <Link
              href="/settings#benachrichtigungen"
              className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground shadow-sm hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Push aktivieren
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-2" aria-label="Benachrichtigungen, neueste zuerst">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.url as Route}
                className="grid gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {item.readAt ? null : <Badge tone="accent">Neu</Badge>}
                  <span className="font-medium">{item.title}</span>
                </span>
                {item.body ? (
                  <span className="text-sm text-foreground-muted">{item.body}</span>
                ) : null}
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
                  <span>
                    {TRIGGER_LABELS[item.trigger]} · {formatWhen(item.updatedAt, now, timeZone)}
                    {item.count > 1 ? ` · ${item.count} Updates` : ""}
                  </span>
                  {item.pushedAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Smartphone aria-hidden className="size-3.5" /> Push gesendet
                    </span>
                  ) : null}
                  {item.emailedAt ? (
                    <span className="inline-flex items-center gap-1">
                      <Mail aria-hidden className="size-3.5" /> E-Mail gesendet
                    </span>
                  ) : null}
                  {item.suppressed ? (
                    <span className="inline-flex items-center gap-1">
                      <BellOff aria-hidden className="size-3.5" />
                      {SUPPRESSED_LABELS[item.suppressed as Exclude<Suppressed, null>] ??
                        item.suppressed}
                      : nur im Cockpit
                    </span>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
