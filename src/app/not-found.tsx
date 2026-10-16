/** Root 404 boundary, rendered on every host including public exposés. */
export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-sm gap-3 text-center">
        <p className="font-mono text-sm text-accent">404</p>
        <h1 className="text-2xl font-semibold">Diese Seite gibt es nicht.</h1>
        <p className="text-foreground-muted">
          Vielleicht hat sich ein Tippfehler in die Adresse eingeschlichen.
        </p>
        {/* A plain link: this boundary is part of every page's payload, and next/link
            would pull a cockpit chunk group into public exposés (ADR-0048). */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- see above */}
        <a href="/" className="text-accent underline underline-offset-4">
          Zur Startseite
        </a>
      </div>
    </main>
  );
}
