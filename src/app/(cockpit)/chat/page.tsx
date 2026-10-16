import { MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { formatRelative } from "@/lib/relative-time";
import { listCallbacks, listThreads } from "@/server/chat/owner";
import { loadAvailability, workspaceAvailable } from "@/server/chat/presence";
import { requireCockpit } from "@/server/session";
import { getDb } from "@/db";
import { AvailabilityControl } from "./availability";
import { CallbackList } from "./callbacks";
import { LiveRefresh } from "./live-refresh";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage() {
  const { workspace, user, tenant } = await requireCockpit();
  const [threads, callbacks, availability] = await tenant(async (tx) =>
    Promise.all([
      listThreads(tx, workspace.id),
      listCallbacks(tx, workspace.id, { openOnly: true }),
      loadAvailability(tx, workspace.id, user.id),
    ]),
  );
  // What visitors see right now, across all members.
  const available = await workspaceAvailable(getDb(), workspace.id);

  return (
    <div className="grid gap-8">
      <LiveRefresh events={["chat.message", "chat.thread", "callback.created"]} />
      <PageHeader
        title="Chat"
        description="Nachrichten aus Ihren Exposés und Rückrufwünsche. Neue erscheinen sofort."
      />

      <Card>
        <CardHeader>
          <CardTitle>Ihre Verfügbarkeit</CardTitle>
          <CardDescription>
            Exposés zeigen „Verfügbar“, solange Sie das Cockpit geöffnet haben oder es hier
            einstellen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityControl initial={availability} available={available} />
        </CardContent>
      </Card>

      {callbacks.length > 0 ? (
        <section aria-labelledby="callbacks" className="grid gap-3">
          <h2 id="callbacks" className="text-lg font-semibold">
            Rückrufwünsche <Badge tone="warning">{callbacks.length} offen</Badge>
          </h2>
          <CallbackList callbacks={callbacks} showCompany />
        </section>
      ) : null}

      <section aria-labelledby="threads" className="grid gap-3">
        <h2 id="threads" className="text-lg font-semibold">
          Unterhaltungen
        </h2>
        {threads.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="grid justify-items-center gap-3 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
                <MessageCircle aria-hidden className="size-5" />
              </span>
              <p className="max-w-md text-sm text-foreground-muted">
                Noch keine Chats. Sobald jemand in einem Exposé schreibt, erscheint die Nachricht
                hier, ohne dass Sie neu laden müssen.
              </p>
              <Link
                href="/exposes"
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                Zu Ihren Exposés
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/chat/${thread.id}`}
                  className="grid gap-1 rounded-xl border border-border bg-surface p-4 shadow-sm transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {thread.companyName}
                      {thread.visitorName ? (
                        <span className="font-normal text-foreground-muted">
                          {" "}
                          · {thread.visitorName}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-foreground-muted">
                      {thread.unread > 0 ? (
                        <Badge tone="accent">
                          {thread.unread} {thread.unread === 1 ? "neu" : "neue"}
                        </Badge>
                      ) : null}
                      {thread.status === "closed" ? <Badge>Erledigt</Badge> : null}
                      <time dateTime={thread.lastMessageAt.toISOString()}>
                        {formatRelative(thread.lastMessageAt)}
                      </time>
                    </span>
                  </span>
                  {thread.preview ? (
                    <span className="line-clamp-2 text-sm text-foreground-muted">
                      {thread.previewAuthor === "owner"
                        ? "Sie: "
                        : thread.previewAuthor === "system"
                          ? "Automatisch: "
                          : ""}
                      {thread.preview}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
