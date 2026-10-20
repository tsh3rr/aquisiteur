import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { TaskList, type TaskItemView } from "@/components/cockpit/tasks";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { can } from "@/domain/authz";
import { taskBucket, type TaskBucket } from "@/domain/tasks";
import { requireCockpit } from "@/server/session";
import { listDoneTasks, listOpenTasks, taskClock, taskItemView } from "@/server/tasks";
import { LiveRefresh } from "../chat/live-refresh";

export const metadata: Metadata = { title: "Aufgaben" };

const SECTIONS: { bucket: TaskBucket; title: string; empty?: string }[] = [
  { bucket: "overdue", title: "Überfällig" },
  { bucket: "today", title: "Heute", empty: "Für heute ist nichts mehr offen." },
  { bucket: "upcoming", title: "Demnächst" },
];

/** All follow-ups across customers (§7.8 „Aufgaben & Wiedervorlagen“). */
export default async function TasksPage() {
  const { workspace, actor, tenant } = await requireCockpit();
  const { open, done, clock } = await tenant(async (tx) => ({
    open: await listOpenTasks(tx, workspace.id),
    done: await listDoneTasks(tx, workspace.id, { sinceDays: 14 }),
    clock: await taskClock(tx, workspace.id),
  }));
  const canManage = can(actor, "prospects.manage", { workspaceId: workspace.id });
  const now = new Date(clock.now);
  const grouped = new Map<TaskBucket, TaskItemView[]>();
  for (const task of open) {
    const bucket = taskBucket(task, now, clock.timeZone);
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), taskItemView(task)]);
  }

  return (
    <div className="grid gap-8">
      <LiveRefresh events={["task.changed"]} />
      <PageHeader
        title="Aufgaben"
        description="Wiedervorlagen über alle Kunden. Neue Aufgaben legen Sie auf der Kundenseite an."
      />

      {open.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <ListChecks aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">Keine offenen Aufgaben.</p>
              <p className="text-sm text-foreground-muted">
                Öffnen Sie einen Kunden und legen Sie dort eine Wiedervorlage an, etwa „Freitag
                anrufen“. Zur Fälligkeit erinnert Sie Aquisiteur per Push und E-Mail.
              </p>
            </div>
            <Link
              href="/kunden"
              className="inline-flex h-11 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              Zu den Kunden
            </Link>
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map(({ bucket, title, empty }) => {
          const items = grouped.get(bucket) ?? [];
          if (items.length === 0 && !empty) return null;
          return (
            <section key={bucket} aria-labelledby={`tasks-${bucket}`} className="grid gap-3">
              <div className="flex items-center gap-2">
                <h2 id={`tasks-${bucket}`} className="text-lg font-semibold">
                  {title}
                </h2>
                <Badge tone={bucket === "overdue" ? "danger" : "neutral"}>{items.length}</Badge>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-foreground-muted">{empty}</p>
              ) : (
                <TaskList
                  tasks={items}
                  clock={clock}
                  showCompany
                  canManage={canManage}
                  label={title}
                />
              )}
            </section>
          );
        })
      )}

      {done.length > 0 ? (
        <details className="group">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground-muted hover:text-foreground">
            Erledigt in den letzten 14 Tagen ({done.length})
          </summary>
          <div className="pt-3">
            <TaskList
              tasks={done.map(taskItemView)}
              clock={clock}
              showCompany
              canManage={canManage}
              label="Erledigt"
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
