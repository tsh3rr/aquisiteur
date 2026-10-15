import { FileJson, Inbox, MailOpen } from "lucide-react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCockpit } from "@/server/session";

export const metadata: Metadata = { title: "Heute" };

export default async function TodayPage() {
  const { workspace, user } = await requireCockpit();
  const firstName = (user.name || "").split(" ")[0];

  return (
    <div className="grid gap-8">
      <header className="grid gap-1">
        <p className="text-sm text-foreground-muted">
          {new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
        </p>
        <h1 className="text-3xl font-semibold">{firstName ? `Hallo ${firstName}.` : "Hallo."}</h1>
      </header>

      <section aria-labelledby="needs-reaction" className="grid gap-4">
        <div className="flex items-center gap-2">
          <h2 id="needs-reaction" className="text-lg font-semibold">
            Braucht jetzt eine Reaktion
          </h2>
          <Badge>0</Badge>
        </div>
        <Card className="border-dashed">
          <CardContent className="grid justify-items-center gap-4 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-foreground">
              <Inbox aria-hidden className="size-5" />
            </span>
            <div className="grid max-w-md gap-1.5">
              <p className="font-medium">Noch ist es ruhig in {workspace.name}.</p>
              <p className="text-sm text-foreground-muted">
                Sobald jemand den QR-Code Ihres Briefs scannt, erscheint er hier, sortiert danach, wie sicher er
                Kontakt aufnehmen möchte.
              </p>
            </div>
          </CardContent>
        </Card>
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
                  <p className="font-medium">Erstes Exposé veröffentlichen</p>
                  <p className="text-sm text-foreground-muted">
                    Claude Code erzeugt das Exposé als JSON, <code className="font-mono">pnpm expose:publish</code>{" "}
                    stellt es online. Kommt in Phase 1.
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
                  <p className="font-medium">Prospects anlegen und Brief drucken</p>
                  <p className="text-sm text-foreground-muted">
                    Kundenliste, Kurzlinks und QR-Codes folgen in Phase 2, der Brief-Generator in Phase 5.
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
