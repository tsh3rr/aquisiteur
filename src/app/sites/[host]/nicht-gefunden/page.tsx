import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { workspaceForHostParam } from "@/server/sites";
import { hitRateLimit } from "@/server/tracking/rate-limit";
import { clientKey, recordMiss } from "@/server/tracking/short-link-guard";
import { shortCodeSuggestions } from "@/server/tracking/visits";

export const metadata: Metadata = {
  title: { absolute: "Link nicht gefunden" },
  robots: { index: false, follow: false },
};

/** „Meinten Sie …?“ (§6.2): the resolver sends unknown codes here. */
export default async function NotFoundCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ code?: string | string[]; zuviele?: string | string[] }>;
}) {
  const workspace = await workspaceForHostParam((await params).host);
  if (!workspace) notFound();
  const query = await searchParams;
  const raw = query.code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 80) ?? "";
  const db = getDb();
  // Every unknown code counts against the client (enumeration guard, §10).
  const allowed = code
    ? await recordMiss(db, workspace.id, await clientKey(await headers()))
    : true;
  const tooMany = Boolean(query.zuviele) || !allowed;
  const suggestions =
    code && !tooMany && (await hitRateLimit(db, `nf:${workspace.id}`, 300, 600))
      ? await shortCodeSuggestions(db, workspace.id, code)
      : [];

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16">
      <div className="grid max-w-md gap-6">
        <div className="grid gap-2">
          <p className="text-sm font-medium text-foreground-muted">{workspace.name}</p>
          <h1 className="text-2xl font-semibold text-balance">
            Diesen Link kennen wir leider nicht.
          </h1>
          {tooMany ? (
            <p role="status" className="text-foreground-muted">
              Es wurden gerade sehr viele unbekannte Links aufgerufen. Bitte versuchen Sie es in
              zehn Minuten erneut.
            </p>
          ) : null}
          {code ? (
            <p className="text-foreground-muted">
              Sie haben <span className="font-medium text-foreground">„{code}“</span> eingegeben.
            </p>
          ) : null}
        </div>
        {suggestions.length > 0 ? (
          <section aria-labelledby="suggestions" className="grid gap-3">
            <h2 id="suggestions" className="font-medium">
              Meinten Sie:
            </h2>
            <ul className="grid gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <a
                    href={`/${suggestion}`}
                    className="flex min-h-11 items-center rounded-lg border border-border bg-surface px-4 font-medium hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    {suggestion}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-sm text-foreground-muted">
          Bitte prüfen Sie die Schreibweise im Brief. Groß- und Kleinschreibung spielen keine Rolle.
          Am einfachsten geht es mit dem QR-Code: Kamera öffnen und auf den Code richten.
        </p>
      </div>
    </main>
  );
}
