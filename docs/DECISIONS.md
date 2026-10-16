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

## ADR-0016 · Kurzlinks: ein Pfadsegment, Resolver als Route-Handler (2026-10-16)

QR-Token (12 Zeichen base62, Groß-/Kleinschreibung zählt) und Kurzcode (4 Zeichen aus dem eindeutigen
Alphabet oder ein lesbarer Slug, Groß-/Kleinschreibung egal) liegen beide direkt unter dem Workspace-Host:
`<host>/<code>`. Feste Routen (`x`, `t`, `assets`, `impressum`, `datenschutz`, `owner-device`,
`nicht-gefunden` …) stehen in `RESERVED_CODES` und können nicht als Code vergeben werden. Ein eigener
`go.`-Host ist damit unnötig.

Der Resolver ist ein Node-Route-Handler (`src/app/sites/[host]/[code]/route.ts`), nicht Teil der
Edge-Middleware: Er braucht die Datenbank, und die Middleware bleibt so frei von I/O (ADR-0006). Auf
Workers mit Hyperdrive liegt ein Aufruf trotzdem bei wenigen zehn Millisekunden. Unbekannte Codes landen
auf „Meinten Sie …?“; Vorschläge kommen nur aus Kurzcodes (Abstand ≤ 1, bei langen Slugs ≤ 2), nie aus
QR-Tokens, und sind pro Workspace rate-limitiert.

Der erste Publish eines Exposés legt automatisch den Touchpoint „Brief“ an; CLI und API geben Kurzlink
und QR-Link aus. Weitere Touchpoints (Folgebrief, Visitenkarte) legt der Owner im Cockpit an, optional
mit eigenem Kurzlink. Touchpoints werden deaktiviert, nie gelöscht, damit Besuche zugeordnet bleiben.

## ADR-0017 · Besuch erst zählen, wenn die Seite wirklich geladen hat (2026-10-16)

Der Resolver legt beim Scan einen Visit an (Gerät, Browser, Stadt aus dem Edge-Header, Bot-Erkennung
über User-Agent und `Sec-Purpose`, keine IP) und leitet mit einem signierten Ticket (15 min, HMAC) auf
`/x/<slug>?v=…` weiter. Erst wenn das Tracking-Script im Exposé das Ticket an `/t/start` schickt, gilt der
Besuch als bestätigt (`confirmed_at`). Sicherheits-Scanner und Vorschauen, die nur den Link abrufen,
erscheinen so als „aufgerufen, Seite nicht geladen“ oder als Bot und lösen nichts aus. Ein Ticket
bestätigt genau einen Visit; das Script entfernt es sofort aus der Adresszeile, damit es nicht in
Lesezeichen oder weitergeleitete Links gerät.

Der erste bestätigte Besuch ohne Bot- und Owner-Flag setzt den Status von „Entwurf“ oder „Brief
versendet“ auf „Geöffnet“ (mit Audit-Eintrag). Spätere Status setzt nur der Owner.

Das Script (≈ 1,5 KB gzip) hält den Visit-Token nur im Speicher: keine Cookies, kein Storage. Es sendet
gebündelt per `fetch(keepalive)` bzw. `sendBeacon` an `/t/e`; der Server prüft jedes Event mit Zod,
verwirft unbekannte einzeln und begrenzt pro Visit (120 Batches je 10 min). Heartbeats fließen nur in
`visits.active_seconds`, nicht als eigene Zeilen in `events`. Rate Limits nutzen die vorhandene Tabelle
`rate_limits` (Präfix `aq:`), damit kein zusätzlicher Dienst nötig ist.

## ADR-0018 · Eigene Besuche über ein Owner-Gerät-Cookie (2026-10-16)

Cockpit (`app.…`) und Exposés (`<workspace>.…` oder eigene Domain) liegen auf verschiedenen Hosts; die
Session ist dort nicht sichtbar. Der Owner markiert deshalb jedes eigene Gerät einmal über einen
signierten Link aus den Einstellungen (10 min gültig). Der Workspace-Host setzt daraufhin `aq_owner`
(httpOnly, 400 Tage), und alle Besuche dieses Browsers zählen als intern. Das ist das einzige Cookie auf
Exposé-Hosts und betrifft nur den Owner, nie Interessenten.

## ADR-0019 · Teilen erzeugt einen eigenen Touchpoint (2026-10-16)

„Mit Kollegen teilen“ holt pro Visit einen eigenen Link (`channel = share`, `parent_visit_id`), der beim
Antippen des Buttons vorab geladen wird, damit das Teilen-Menü auf iOS noch in der Nutzergeste öffnet.
Besuche über diesen Link heißen in der Timeline „Weitergeleiteten Link geöffnet“. So wird sichtbar, wenn
ein Exposé intern weitergereicht wird.

## ADR-0020 · Realtime-Port: SSE im Speicher lokal, Supabase Broadcast in Produktion (2026-10-16)

Chat, Tippanzeige und Cockpit-Hinweise laufen über `RealtimePort` mit zwei Themen: `ws-<workspace>`
(Cockpit) und `chat-<thread>` (Besucher). Browser hören nur zu, geschrieben wird immer über die
App-Routen (Validierung, RLS, Audit). Lokal und in Tests liefert der `memory`-Adapter Server-Sent
Events aus dem eigenen Prozess. Auf Cloudflare ist das unmöglich (kein gemeinsamer Speicher zwischen
Isolates), dort ist `REALTIME_PROVIDER=supabase` Pflicht: Der Server sendet per REST-Broadcast mit dem
Secret Key, Browser verbinden sich per WebSocket mit dem Publishable Key. Kanalnamen tragen einen HMAC
des Themas, den nur die App vergibt (signierte Tokens, 12 h Cockpit, 3 Tage Chat). Ohne SDK: ein
kleiner Phoenix-Client in `src/infra/realtime-client.ts`, der einzige erlaubte `@/infra/*`-Import im
Browser. Durable Objects bleiben eine spätere Alternative hinter demselben Port.

## ADR-0021 · Chat-Verlauf nur im Tab (sessionStorage) (2026-10-16)

Interessenten bleiben anonym und ohne Cookie. Der Token eines Chat-Verlaufs liegt in
`sessionStorage` unter `aq-chat:<slug>`: Ein Neuladen behält das Gespräch, ein neuer Tab oder ein
anderes Gerät beginnt neu. Damit Antworten trotzdem ankommen, fragt das Widget nach der ersten
Nachricht freiwillig nach einem Rückkanal (WhatsApp, SMS, Anruf, E-Mail).

## ADR-0022 · Abwesenheitsnotiz: Browser stößt an, Server entscheidet (2026-10-16)

Ohne Job-Queue (kommt in Phase 4) fragt das Widget nach zwei Minuten ohne Antwort `/t/chat/offline`
an. Der Server prüft mit `offlineNoticeDue`, ob seit der letzten Besuchernachricht weder der Owner
geantwortet hat noch schon eine Notiz ging. So kommt pro unbeantwortetem Abschnitt höchstens eine Notiz,
auch bei mehreren Tabs.

## ADR-0023 · Entwurfserkennung speichert standardmäßig nur die Länge (2026-10-16)

Getippte, nicht gesendete Nachrichten sind ein starkes Signal, aber auch heikel. Standardmäßig wird
nur die Zeichenzahl gespeichert („Hat 140 Zeichen geschrieben, nicht gesendet“). Den Inhalt speichert
die App nur, wenn der Workspace `chat.storeDraftContent` einschaltet; das Widget zeigt dann einen
sichtbaren Hinweis unter dem Eingabefeld.

## ADR-0024 · Status „Kontakt“ automatisch, nie zurück (2026-10-16)

Eine Chat-Nachricht oder ein Rückrufwunsch setzt den Kunden auf „Kontakt“ (`advanceStatus`), ein echter
Besuch auf „Geöffnet“. Der Status rückt nur vor, nie zurück, und jede Änderung landet mit Auslöser im
Audit-Log.

## ADR-0025 · Terminbuchung als Link statt Einbettung (2026-10-16)

Der Kanal `booking` ist ein Link auf die Buchungsseite des Owners (Cal.com, Calendly …). Ein
eingebettetes Widget würde Drittanbieter-Skripte und -Cookies auf jedes Exposé bringen und die
Performance-Grenze (ADR-0014) sprengen.

## ADR-0026 · Verfügbarkeit über Präsenz-Heartbeat (2026-10-16)

Ein offenes Cockpit meldet alle 60 s Präsenz (`member_presence`), gültig 3 Minuten. „Automatisch“
zeigt Besuchern „verfügbar“, solange ein Mitglied online ist; „Verfügbar“ und „Abwesend“ überschreiben
das. Der Launcher zeigt den Status mit Text, nicht nur mit Farbe.

## ADR-0027 · Lighthouse-CI: Server vorwärmen, Median aus fünf Läufen (2026-10-16)

Der erste Lauf gegen einen frisch gestarteten Node-Server misst das Kompilieren der Route mit (0,71 statt
0,88–0,96). In Produktion auf Workers gibt es diesen Kaltstart pro Exposé nicht. Die CI ruft jede URL
deshalb vorher dreimal ab und nimmt den Median aus fünf statt drei Läufen. Die Grenze bleibt 90.
