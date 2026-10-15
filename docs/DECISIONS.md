# Entscheidungen (ADRs)

Kurz und datiert. Neue Entscheidungen unten anhängen; überholte nicht löschen, sondern als ersetzt markieren.

## ADR-0001 · Versionen der Werkzeuge (2026-10-15)

- **Next.js 16.4** (App Router, Turbopack), **React 19.3**, **@opennextjs/cloudflare 1.20**.
- **TypeScript 6.0**, nicht 7.0: `typescript-eslint` unterstützt bis `<6.1`. Wechsel, sobald das Ökosystem nachzieht.
- **ESLint 9**, nicht 10: `eslint-plugin-jsx-a11y` und `eslint-config-next` deklarieren noch ESLint ≤ 9.
- **Tailwind 4.3**, **Zod 4**, **Drizzle 0.45**, **Better Auth 1.7**, **Vitest 5**, **Playwright 1.64**.
- shadcn/ui wird nicht per CLI eingespielt, sondern die wenigen Bausteine werden im shadcn-Stil direkt auf
  Radix (`radix-ui`) geschrieben. Gleiches Ergebnis, weniger Fremdcode.

## ADR-0002 · Mandantentrennung per Rollenwechsel und RLS (2026-10-15)

Jede Workspace-Abfrage läuft in einer Transaktion mit `SET LOCAL ROLE aquisiteur_app` und den
Transaktionsvariablen `app.user_id` und `app.workspace_id` (`withTenant()` in `src/db/client.ts`). Die
Policies prüfen **Mitgliedschaft** und **ausgewählten Workspace**. Mitgliedschaftsprüfung über
`SECURITY DEFINER`-Funktionen, damit Policies auf `memberships` nicht rekursiv werden.

Die Login-Rolle (Eigentümer der Tabellen) bleibt für Auth, Workspace-Anlage (vorher gibt es noch keine
Mitgliedschaft), Host-Auflösung öffentlicher Seiten und spätere Jobs. Das ist die einzige Stelle mit
„Service-Role“-Rechten, und sie ist nur serverseitig erreichbar.

Alternativen: Supabase-Auth-JWT + `auth.uid()` (bindet an Supabase, widerspricht §5a); Filter nur im
App-Code (keine echte Isolation). Verworfen.

## ADR-0003 · Anbieter nur hinter Ports (2026-10-15)

`src/infra/types.ts` deklariert alle Ports aus §5a. `getInfra()` in `src/infra/index.ts` ist die einzige
Fassade. ESLint verbietet außerhalb von `src/infra/` Imports von `cloudflare:*`, `@opennextjs/cloudflare`,
`resend`, `@aws-sdk/*`, `@supabase/*` usw. sowie Deep-Imports konkreter Adapter. Ports ohne Bedarf in
Phase 0 sind deklariert, aber noch nicht implementiert (Phase steht am Interface).

Der E-Mail-Adapter ist Resend (läuft auf jedem Host). Für die Entwicklung gibt es einen `log`-Adapter, der
Mails ins Server-Log schreibt; in Produktion verweigert er den Dienst.

## ADR-0004 · Anmeldung (2026-10-15)

- Magic Link (10 min, einmalig, **Token gehasht gespeichert**) und Passkeys (`@better-auth/passkey`).
  Kein Passwort.
- **Keine öffentliche Registrierung** (§9a): Konten nur für Adressen aus `SIGNUP_ALLOWLIST`. Unbekannte
  Adressen bekommen dieselbe Antwort, aber keine Mail (keine Enumeration).
- Sessions **3 Tage rollierend** (Verlängerung höchstens einmal täglich), `freshAge` 10 min für spätere
  sensible Aktionen. Kompromiss aus „kurze Laufzeit“ (§10) und Handy-Nutzung unterwegs; mit Passkey ist
  die Neuanmeldung ein Fingertipp.
- IP-Adressen werden in Sessions **nicht** gespeichert (§9). Das Rate Limiting der Anmeldung nutzt die IP
  kurzzeitig als Schlüssel in `rate_limits` (Postgres, portabel); die Bereinigung alter Einträge kommt mit
  den Retention-Jobs in Phase 6.

## ADR-0005 · Design Tokens als TypeScript-Quelle (2026-10-15)

Tokens stehen in `src/design/tokens.ts` (OKLCH). `pnpm tokens:build` erzeugt `src/styles/tokens.css`. Ein
Unit-Test prüft, dass die CSS-Datei aktuell ist und **alle genutzten Farbpaare in Hell und Dunkel WCAG AA**
erreichen. Dieselbe Kontrastberechnung (`src/lib/color.ts`, inkl. `ensureContrast`) korrigiert in Phase 1
die Akzentfarben der Exposés automatisch (§7.2).

UI-Schrift: Geist Sans/Mono, selbst gehostet über das `geist`-Paket. Display-Schrift für Exposés wird in
Phase 1 gewählt.

## ADR-0006 · `middleware.ts` statt `proxy.ts` (2026-10-15)

Next 16 benennt Middleware in „Proxy“ um, der aber nur in der Node-Runtime läuft. OpenNext unterstützt
Node-Middleware auf Workers nur experimentell („not officially maintained“), Edge-Middleware dagegen
offiziell. Deshalb bleibt es bei `src/middleware.ts` (Edge). Next gibt beim Build eine
Deprecation-Warnung aus; Wechsel auf `proxy.ts`, sobald OpenNext Node-Middleware offiziell unterstützt.

## ADR-0007 · CSP mit Nonce pro Anfrage (2026-10-15)

Strenge CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`)
schon ab Phase 0 (§10). Folge: alle Seiten werden dynamisch gerendert. Für die statisch gecachten Exposés
(Phase 1, §7.3) wird eine eigene CSP ohne Nonce gebraucht (z. B. Hash-basiert oder nur eigene
Script-Dateien). Das wird in Phase 1 entschieden. `style-src` erlaubt `'unsafe-inline'`, weil Next und
Radix Inline-Styles setzen; Styles können keinen Code ausführen.

## ADR-0008 · Workspace-Einstellungen als JSONB pro Bereich (2026-10-15)

`workspace_settings` hat eine Zeile pro Workspace mit je einer JSONB-Spalte pro Bereich (Profil, Kanäle,
Absender, Branding, Recht, Score-Gewichte, Nudges, Aufbewahrung). Jede Spalte hat ein Zod-Schema mit
Defaults (`src/domain/workspace-settings.ts`). Neue Felder brauchen so keine Migration, alte Zeilen bleiben
gültig.

## ADR-0009 · Logo-Upload im Assistenten erst mit Phase 1 (2026-10-15)

§9a nennt das Logo als Teil des Onboardings. Datei-Uploads brauchen den Storage-Port (R2), der mit der
Exposé-Veröffentlichung in Phase 1 kommt. Bis dahin hat der Assistent vier Schritte ohne Logo; Phase 1
ergänzt Logo und Owner-Foto.

## ADR-0010 · Supabase über den Session Pooler (2026-10-15)

`withTenant()` setzt Rolle und Variablen mit `SET LOCAL` in einer Transaktion. Das funktioniert mit
Hyperdrive und mit dem Supabase **Session Pooler** (Port 5432). Prepared Statements sind abgeschaltet
(`prepare: false`), damit auch Transaction-Pooler funktionieren würden.

## ADR-0011 · Pingen als erster Druck-Provider (2026-10-15)

Vom Owner entschieden (ZIELPROMPT §7.9). Die Schnittstelle `LetterDispatchProvider` ist in
`src/infra/types.ts` deklariert; der Adapter folgt nach dem `manual`-Provider (Phase 5 bzw. „Später“).
Zugangsdaten werden pro Workspace in `integrations` mit AES-256-GCM verschlüsselt
(`src/lib/crypto.ts`, Kontext = Workspace + Integration, damit Ciphertexte nicht zwischen Workspaces
verschiebbar sind).

## ADR-0012 · Exposés pro Anfrage gerendert, Nonce-CSP bleibt (2026-10-15)

Löst die offene Frage aus ADR-0007. Exposés werden pro Anfrage auf dem Server gerendert statt statisch
gecacht. Damit bleibt die strenge Nonce-CSP auch auf Exposé-Seiten, und „offline nehmen“ oder eine neue
Version wirken sofort, ohne Cache-Invalidierung. Die Kosten sind gering: eine indizierte Abfrage
(Workspace + Slug) pro Aufruf. Statisch und unveränderlich gecacht werden nur die Bilddateien
(`/assets/<sha256>/<datei>`, `Cache-Control: immutable`), weil ihr Name ihr Inhalt ist.

Öffentliche Lesezugriffe (Exposé, Opt-out, Bilder) laufen ohne Mandantenkontext über die
System-Verbindung, sind aber immer explizit auf den Workspace des Hosts gescoped (Host → Workspace →
Slug bzw. Storage-Präfix `<workspace>/`). Im Cockpit liest die Vorschau dieselben Daten als Tenant (RLS)
über `/preview/…`.

## ADR-0013 · Speicher: S3-kompatibel (R2), Upload pro Datei, Bilder vorab optimiert (2026-10-15)

`StoragePort` hat zwei Adapter: S3 (R2, Supabase Storage, MinIO; per `aws4fetch`, ohne SDK) und ein
lokales Verzeichnis für Entwicklung und Tests. Dateien sind pro Workspace inhaltsadressiert
(`<workspace>/assets/<sha256>/<breite>.<format>`), doppelte Uploads entfallen.

Bilder werden vor dem Upload verkleinert: Die CLI erzeugt mit `sharp` AVIF und WebP in 480/960/1600 px,
der Browser skaliert Foto und Logo im Cockpit per Canvas (WebP, sonst PNG). Der Server prüft nur
Magic Bytes und Größen; Workers haben keine Bildbibliothek und 128 MB Speicher. Aus demselben Grund lädt
die CLI jede Datei einzeln hoch (`/api/v1/assets`) und schickt danach nur das JSON (`/api/v1/exposes`),
statt alles in einem Request.

## ADR-0014 · Lighthouse: Ziel 95, CI-Grenze 90 im Median (2026-10-15)

Die simulierte Mobil-Messung von Lighthouse schwankt zwischen Läufen um ±3 Punkte. Gemessen mit den
Beispiel-Exposés: Performance 93 bis 97, Barrierefreiheit, Best Practices und SEO je 100 (SEO ohne
`is-crawlable`, weil Exposés absichtlich `noindex` sind). Der Rest bis 100 ist die React-/Next-Laufzeit
(~100 KB gzip), die Lighthouse in seiner Simulation vor das LCP rechnet. Im echten Browser mit
4G-Drosselung liegt LCP bei rund 1,1 s und erfüllt damit das Ziel „LCP < 1,5 s auf 4G“ (§7.3).

Die CI (`lighthouserc.cjs`) bricht deshalb erst unter 90 im Median dreier Läufe ab. Ziel bleibt 95.
Schon umgesetzt: Schriften als Latin-Subsets, keine ungenutzten Preloads, kein `tailwind-merge` in
Exposé-Client-Bundles, Bilder mit festen Maßen und AVIF.

## ADR-0015 · Prospects aus dem Exposé, Opt-out per Formular-POST (2026-10-15)

Der erste Publish eines `prospect.key` legt Prospect und Hauptkontakt an; spätere Publishes erzeugen nur
neue Versionen und überschreiben im Cockpit gepflegte Daten nie. Ein Prospect hat genau ein Exposé mit
stabilem Slug und Ref-Code; Versionen sind unveränderlich und tragen ein Manifest ihrer Dateien.

„Kein Interesse“ braucht einen Klick auf einer Bestätigungsseite, damit Link-Vorschauen und
Sicherheits-Scanner (nur GET) nichts auslösen. Der Klick ist ein normaler Formular-POST auf einen
Route-Handler mit 303-Weiterleitung, keine Server Action: deren Redirect läuft nicht durch das
Host-Routing der Middleware. Cross-Site-POSTs werden per `Origin`-Prüfung abgewiesen.
