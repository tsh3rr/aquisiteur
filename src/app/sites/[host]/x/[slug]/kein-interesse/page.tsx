import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { loadPublicExpose } from "@/server/exposes/load";
import { workspaceForHostParam } from "@/server/sites";

export const metadata: Metadata = {
  title: { absolute: "Kein Interesse" },
  robots: { index: false, follow: false },
};

type Params = Promise<{ host: string; slug: string }>;

/**
 * Opt-out with an explicit confirmation button: link previews and security
 * scanners only fetch (GET), so they can never trigger it by accident.
 */
export default async function OptOutPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ done?: string }>;
}) {
  const { host, slug } = await params;
  const { done } = await searchParams;
  const workspace = await workspaceForHostParam(host);
  if (!workspace) notFound();
  const data = await loadPublicExpose(getDb(), workspace.id, slug);
  if (!data) notFound();
  const owner = data.settings.profile.displayName ?? data.workspace.name;

  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-background px-5 py-16">
      <div className="grid max-w-lg gap-5 rounded-2xl border border-border bg-surface p-8 shadow-md">
        {done ? (
          <>
            <h1 className="text-2xl font-semibold">Verstanden.</h1>
            <p className="text-foreground-muted">
              {owner} wird Sie nicht mehr kontaktieren. Vielen Dank für Ihre Rückmeldung.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Kein Interesse?</h1>
            <p className="text-foreground-muted">
              Dann bestätigen Sie bitte kurz. {owner} schickt Ihnen danach keine weiteren Briefe
              oder Nachrichten zu diesen Vorschlägen.
            </p>
            {/* Plain POST (works without JavaScript); see bestaetigen/route.ts. */}
            <form
              method="post"
              action={`/x/${slug}/kein-interesse/bestaetigen`}
              className="flex flex-wrap gap-3"
            >
              <button
                type="submit"
                className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 font-semibold text-accent-foreground hover:bg-accent-hover"
              >
                Bitte nicht mehr kontaktieren
              </button>
              <a
                href={`/x/${slug}`}
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-5 font-medium hover:bg-surface-sunken"
              >
                Zurück zu den Vorschlägen
              </a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
