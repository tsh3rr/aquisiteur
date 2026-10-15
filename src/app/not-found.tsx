import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div className="grid max-w-sm gap-3 text-center">
        <p className="font-mono text-sm text-accent">404</p>
        <h1 className="text-2xl font-semibold">Diese Seite gibt es nicht.</h1>
        <p className="text-foreground-muted">
          Vielleicht hat sich ein Tippfehler in die Adresse eingeschlichen.
        </p>
        <Link href="/" className="text-accent underline underline-offset-4">
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
