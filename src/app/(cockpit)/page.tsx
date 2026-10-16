import { FileJson, Inbox, MailOpen, MessageCircle } from "lucide-react";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { workspaceSettings } from "@/db/schema";
import { profileSchema } from "@/domain/workspace-settings";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listCallbacks, listThreads } from "@/server/chat/owner";
import { requireCockpit } from "@/server/session";
import { CallbackList } from "./chat/callbacks";
import { LiveRefresh } from "./chat/live-refresh";

export const metadata: Metadata = { title: "Heute" };

export default async function TodayPage() {
  const { workspace, user, tenant } = await requireCockpit();
  const [row] = await tenant((tx) =>
    tx
      .select({ profile: workspaceSettings.profile })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspace.id)),
  );
  const [threads, callbacks] = await tenant(async (tx) =>
    Promise.all([
      listThreads(tx, workspace.id, { limit: 50 }),
      listCallbacks(tx, workspace.id, { openOnly: true }),
    ]),
  );
  const unreadThreads = threads.filter((thread) => thread.unread > 0);
  const waiting = unreadThreads.length + callbacks.length;
  const displayName = profileSchema.safeParse(row?.profile).data?.displayName || user.name || "";
  const firstName = displayName.split(" ")[0];

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm text-foreground-muted">
          {new Intl.DateTimeFormat("de-DE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date())}
        </p>
        <h1 className="text-3xl font-semibold">{firstName ? `Hallo ${firstName}.` : "Hallo."}</h1>
      </header>

      <LiveRefresh events={["chat.message", "callback.created"]} />
      <section aria-labelledby="needs-reaction" className="grid gap-4">
        <div className="flex items-center gap-2">
          <h2 id="needs-reaction" className="text-lg font-semibold">
            Braucht jetzt eine Reaktion
          </h2>
          <Badge tone={waiting > 0 ? "accent" : "neutral"}>{waiting}</Badge>
        </div>
        {waiting === 0 ? (
          <Card className="border-dashed">
            <CardContent className="grid justify-items-center gap-4 py-14 text-center">
              <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
                <Inbox aria-hidden className="size-5" />
              </span>
              <div className="grid max-w-md gap-1.5">
                <p className="font-medium">Noch ist es ruhig in {workspace.name}.</p>
                <p className="text-sm text-foreground-muted">
                  Neue Chat-Nachrichten und Rückrufwünsche erscheinen hier sofort. Wer gerade Ihr
                  Exposé liest, sehen Sie unter Kunden.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {unreadThreads.length > 0 ? (
              <ul className="grid gap-2">
                {unreadThreads.map((thread) => (
                  <li key={thread.id}>
                    <Link
                      href={`/chat/${thread.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                    >
                      <span className="grid gap-0.5">
                        <span className="flex items-center gap-2 font-semibold">
                          <MessageCircle aria-hidden className="size-4 text-accent" />
                          {thread.companyName} wartet auf Antwort
                        </span>
                        {thread.preview ? (
                          <span className="line-clamp-1 text-sm text-foreground-muted">
                            „{thread.preview}“
                          </span>
                        ) : null}
                      </span>
                      <Badge tone="accent">
                        {thread.unread}{" "}
                        {thread.unread === 1 ? "neue Nachricht" : "neue Nachrichten"}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {callbacks.length > 0 ? <CallbackList callbacks={callbacks} showCompany /> : null}
          </div>
        )}
      </section>

      <section aria-labelledby="next-steps" className="grid gap-4">
        <h2 id="next-steps" className="text-lg font-semibold">
          Nächste Schritte
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2">
          <li>
            <Card className="h-full">
              <CardContent className="flex gap-4">
                <FileJson aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <div className="grid gap-1">
                  <Link href="/exposes" className="font-medium hover:underline">
                    Exposé veröffentlichen
                  </Link>
                  <p className="text-sm text-foreground-muted">
                    Claude Code erzeugt das Exposé als JSON,{" "}
                    <code className="font-mono">pnpm expose:publish</code> stellt es online und gibt
                    Kurzlink und QR-Link für den Brief aus.
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
          <li>
            <Card className="h-full">
              <CardContent className="flex gap-4">
                <MailOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                <div className="grid gap-1">
                  <Link href="/kunden" className="font-medium hover:underline">
                    Kunden pflegen und QR-Codes holen
                  </Link>
                  <p className="text-sm text-foreground-muted">
                    Auf jeder Kundenseite liegen Links und QR-Codes zum Herunterladen. Der
                    Brief-Generator folgt in Phase 5.
                  </p>
                </div>
              </CardContent>
            </Card>
          </li>
        </ol>
      </section>
    </div>
  );
}
