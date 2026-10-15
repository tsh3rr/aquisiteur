import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { workspaceForHostParam } from "@/server/sites";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const DEVICE_NOTICES: Record<string, string> = {
  markiert:
    "Dieses Gerät ist jetzt als Ihr eigenes markiert. Ihre Besuche auf Exposés zählen nicht als Kundenbesuche.",
  entfernt: "Dieses Gerät ist nicht mehr als Ihr eigenes markiert.",
  ungueltig:
    "Der Link ist abgelaufen. Bitte öffnen Sie ihn erneut aus den Einstellungen im Cockpit.",
};

/** Home of a workspace host: exposés and short links live below it. */
export default async function WorkspaceSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ geraet?: string }>;
}) {
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) notFound();
  const notice = DEVICE_NOTICES[(await searchParams).geraet ?? ""];

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-md gap-4 text-center">
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        {notice ? (
          <p role="status" className="rounded-lg border border-border bg-surface p-4 text-sm">
            {notice}
          </p>
        ) : null}
        <p className="text-foreground-muted">
          Hier erscheinen persönliche Exposés. Haben Sie einen Brief von uns erhalten? Scannen Sie
          den QR-Code oder tippen Sie den Link aus dem Brief ein.
        </p>
      </div>
    </main>
  );
}
