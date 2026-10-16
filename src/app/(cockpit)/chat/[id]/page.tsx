import { ArrowLeft, Mail, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { telHref, whatsappHref } from "@/domain/expose/contact-links";
import { loadThread } from "@/server/chat/owner";
import { loadWorkspaceSettings } from "@/server/workspaces";
import { requireCockpit } from "@/server/session";
import { ThreadStatusButton } from "./status-button";
import { ThreadView } from "./thread-view";

export const metadata: Metadata = { title: "Chat" };

const channelLabel = { email: "E-Mail", phone: "Telefon", whatsapp: "WhatsApp" } as const;

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { workspace, tenant } = await requireCockpit();
  const [detail, settings] = await tenant(async (tx) =>
    Promise.all([loadThread(tx, workspace.id, id), loadWorkspaceSettings(tx, workspace.id)]),
  );
  if (!detail) notFound();
  const { thread, prospect } = detail;
  const canHandOver = whatsappHref(settings.channels, "-") !== null;
  const visitorWhatsapp = thread.visitorPhone
    ? whatsappHref({ whatsapp: thread.visitorPhone }, `Hallo, hier ist ${workspace.name}.`)
    : null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href="/chat"
          className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" /> Alle Chats
        </Link>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold">
              Chat mit {thread.visitorName ?? prospect.companyName}
            </h1>
            <p className="text-sm text-foreground-muted">
              <Link
                href={`/kunden/${prospect.id}`}
                className="text-accent underline-offset-4 hover:underline"
              >
                {prospect.companyName}
              </Link>{" "}
              · Ref {detail.refCode} {thread.status === "closed" ? <Badge>Erledigt</Badge> : null}
            </p>
          </div>
          <ThreadStatusButton threadId={thread.id} status={thread.status} />
        </header>
      </div>

      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="lg:col-span-2">
          <ThreadView
            threadId={thread.id}
            prospectId={prospect.id}
            initialMessages={detail.messages}
            initialDraft={
              detail.draft ? { length: detail.draft.length, content: detail.draft.content } : null
            }
            canHandOver={canHandOver}
          />
        </div>
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Rückkanal</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {thread.returnChannel ? (
              <>
                <p>
                  {thread.visitorName ? `${thread.visitorName} möchte` : "Gewünscht:"}{" "}
                  {thread.visitorName ? "per " : ""}
                  <strong>{channelLabel[thread.returnChannel]}</strong>
                  {thread.visitorName ? " erreicht werden." : ""}
                </p>
                <ul className="grid gap-1">
                  {thread.visitorEmail ? (
                    <li>
                      <a
                        href={`mailto:${thread.visitorEmail}?subject=${encodeURIComponent(`Ihre Nachricht [Ref ${detail.refCode}]`)}`}
                        className="inline-flex min-h-11 items-center gap-2 text-accent underline-offset-4 hover:underline"
                      >
                        <Mail aria-hidden className="size-4" /> {thread.visitorEmail}
                      </a>
                    </li>
                  ) : null}
                  {thread.visitorPhone ? (
                    <li>
                      <a
                        href={telHref(thread.visitorPhone)}
                        className="inline-flex min-h-11 items-center gap-2 text-accent underline-offset-4 hover:underline"
                      >
                        <Phone aria-hidden className="size-4" /> {thread.visitorPhone}
                      </a>
                    </li>
                  ) : null}
                  {visitorWhatsapp && thread.returnChannel === "whatsapp" ? (
                    <li>
                      <a
                        href={visitorWhatsapp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-2 text-accent underline-offset-4 hover:underline"
                      >
                        <MessageCircle aria-hidden className="size-4" /> Per WhatsApp schreiben
                      </a>
                    </li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p className="text-foreground-muted">
                Noch keiner. Das Exposé fragt nach der ersten Nachricht, wie Sie antworten können,
                falls das Fenster geschlossen wird.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
