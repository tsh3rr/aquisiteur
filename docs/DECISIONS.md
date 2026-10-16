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

Nachtrag zu ADR-0027: Gereicht hat erst, die Kontaktebene (Launcher, Nudges, Leiste) nach dem
`load`-Ereignis im Leerlauf nachzuladen (`ContactLayerLazy`). Ein Klick auf „Live-Chat“ davor lädt sie
sofort und öffnet den Chat.

## ADR-0028 · Kontaktabsicht als materialisierter Score (2026-10-16)

Der Score (§7.6) wird nach jedem Signal neu berechnet und in `intent_scores` gespeichert (eine Zeile pro
Kunde: Score, Stufe, Signale, Erklärung). Listen sortieren damit ohne Rechnen, und „Heute“ zeigt
Erklärung und Empfehlung direkt. Die Quelle bleiben Events, Entwürfe, Nachrichten und Rückrufe; die
Zeile ist abgeleitet und jederzeit neu berechenbar, etwa nach geänderten Gewichten. Formel: Noisy-OR
`1 − Π(1 − pᵢ)`, ohne bestätigtes Signal höchstens 99 %. Erklärung und Empfehlung sind Regeln, kein LLM.

## ADR-0029 · Benachrichtigungen: Regeln, Bündelung, Ruhezeit (2026-10-16)

Regeln (`notification_rules`) verbinden Ereignis, Kanäle und Bedingungen. Jede Benachrichtigung wird
in `notifications` gespeichert, auch in der Ruhezeit oder am Wochenende (dann nur im Cockpit, mit
Grund). Updates mit gleichem `group_key` innerhalb von 30 Minuten zählen in dieselbe Zeile hoch; nur
neue Chat-Nachrichten aktualisieren dabei den Push (gleicher `tag`, ersetzt statt stapelt). Löst eine
Chat-Nachricht oder ein Rückruf zugleich die Score-Schwelle aus, geht nur eine Benachrichtigung raus.

## ADR-0030 · Web Push ohne Bibliothek (2026-10-16)

`web-push` braucht Node-Crypto und läuft nicht auf Workers. Verschlüsselung (RFC 8291, aes128gcm) und
VAPID (RFC 8292) sind mit WebCrypto in `src/infra/webpush` umgesetzt und gegen den Testvektor der RFC
geprüft. Dev und Tests nutzen den Log-Adapter (`PUSH_LOG_FILE`). Abgelaufene Abos (404/410) werden
gelöscht.

## ADR-0031 · E-Mails als schlichte Vorlagen (2026-10-16)

Anmeldelink, Benachrichtigung und Tageszusammenfassung sind kleine Funktionen mit Text- und HTML-Teil,
ohne React Email oder Bilder. Sie laufen auf Workers, sind in jedem Postfach lesbar und leicht zu testen.

## ADR-0032 · Hintergrundarbeit mit `after()` und stündlichem Cron (2026-10-16)

Score, Benachrichtigung und Push laufen nach der Antwort an den Besucher (`defer()` → `after()`, auf
Workers `waitUntil`). Eine Queue lohnt sich dafür noch nicht. Zeitgesteuertes (Tageszusammenfassung)
läuft über `/api/jobs/hourly` mit `CRON_SECRET`. Auf Cloudflare ruft der Cron-Trigger diese Route über
`worker.mjs` auf, woanders `pnpm jobs:hourly` aus der Crontab. Der Job ist idempotent: pro Workspace
und lokalem Tag höchstens eine Zusammenfassung, nachgeholt, falls die Stunde verpasst wurde, und
keine, wenn nichts passiert ist.

## ADR-0033 · Kontakt-Signale aus dem Exposé (2026-10-16)

Neu sind `cta_hover` (Maus oder Fokus mindestens 1 s auf einem Kontaktweg, einmal pro Kanal und
Besuch) und `blockType` an Abschnitts-Events, damit „Kontaktbereich angesehen“ unabhängig von der
Block-ID erkannt wird. Kopieren von Telefonnummer oder E-Mail-Adresse meldet `copy_contact`.

## ADR-0034 · Push-Abos pro Gerät und Mitglied (2026-10-16)

Jedes Mitglied aktiviert Push auf seinen Geräten selbst (`push_subscriptions`, mit Gerätename). Eine
Benachrichtigung geht an alle Geräte des Workspaces. Auf dem iPhone funktioniert Push nur aus der zum
Home-Bildschirm hinzugefügten App; die Einstellungen sagen das. Der Service Worker (`/sw.js`) macht nur
Benachrichtigungen, kein Caching.

## ADR-0035 · Worker passt in den Free-Plan von Cloudflare (2026-10-16)

Mit Turbopack war der Worker komprimiert 3,8 MB groß, weil jede Route eigene Kopien von Better Auth,
Drizzle und dem Resend-SDK bekam. Der Free-Plan erlaubt 3 MB. `next build --webpack` legt gemeinsamen
Code zusammen, und Resend läuft jetzt über `fetch` statt über das SDK: zusammen 2,6 MB, ohne ein Feature
wegzulassen. Die CI prüft im Job „Cloudflare bundle“, dass es unter 2.900 KiB bleibt. Lokal bleibt
`next dev` bei Turbopack. Offen bleibt die CPU-Grenze des Free-Plans (10 ms pro Anfrage): Seiten, die
auf dem Server gerendert werden, können sie überschreiten. Der Free-Plan taugt daher zum Testen und
für wenig Verkehr; für den Betrieb bleibt Workers Paid empfohlen.

## ADR-0036 · Deployment über Workers Builds und das Dashboard (2026-10-16)

Der Betreiber richtet alles über die Weboberflächen ein. Cloudflare Workers Builds baut jeden Push auf
`main` aus GitHub; der Deploy-Befehl `pnpm cf:release` spielt zuerst die Migrationen ein
(`DATABASE_URL` als Build-Secret) und veröffentlicht danach. So bleibt die Reihenfolge „erst migrieren,
dann deployen“ ohne zweites System (eine GitHub Action könnte mit dem Build um die Wette laufen).
Variablen und Secrets liegen im Worker-Dashboard; `keep_vars: true` in `wrangler.jsonc` verhindert, dass
ein Deploy sie löscht. Nur die Hyperdrive-ID steht in `wrangler.jsonc`, weil das Binding dort definiert
sein muss. Für die zwei Schritte ohne Klickweg (Schlüssel erzeugen, Exposé veröffentlichen) reicht ein
GitHub Codespace im Browser; `pnpm deploy:secrets` gibt alle Schlüssel auf einmal aus.

## ADR-0037 · Brief-PDF entsteht im Browser (2026-10-16)

Das DIN-5008-PDF (Form B, Faltmarken, Anschriftfeld für DL-Fensterkuverts) rendert `@react-pdf/renderer`
im Browser, erst beim Klick auf „PDF herunterladen“ nachgeladen. Der Server liefert nur die fertig
zusammengesetzten Daten (`loadPrintableLetters`). Auf dem Worker wäre das Rendern zu groß (Bundle) und zu
teuer (CPU-Grenze). `next.config.ts` hält react-pdf, Leaflet und rrweb per Alias aus dem Server-Bundle;
ohne das wuchs der Worker auf 3,4 MB. Die Layout-Engine (yoga) ist WebAssembly; die Cockpit-CSP erlaubt
dafür `'wasm-unsafe-eval'` (kein JS-`eval`) und `connect-src data:`. Schriften: Geist (OFL) als WOFF in
`public/fonts/letter/`.

## ADR-0038 · Briefversand mit `manual`-Provider und Lebenszyklus (2026-10-16)

Briefe durchlaufen `draft → queued → submitted → printed → posted` (dazu `returned`, `failed`,
`cancelled`), rein in `src/domain/letters/lifecycle.ts`. Der `manual`-Provider steht hinter
`LetterDispatchProvider`: Der Owner druckt das PDF selbst und markiert „versendet“ mit Versanddatum;
dabei läuft der Brief den Weg bis `posted` durch. Ab dem Versanddatum zählen Öffnung und Zeit bis zur
Öffnung, der Kunde springt von „Entwurf“ auf „Brief versendet“. Kosten pro Brief kommen aus den
Einstellungen (Standard 1,10 €), solange kein Provider einen Preis liefert. Ein Folgebrief bekommt einen
eigenen Touchpoint (eigener Code), damit sichtbar wird, welcher Brief gewirkt hat. Pingen folgt als
zweiter Adapter ohne Änderung am Lebenszyklus.

## ADR-0039 · Kampagnen und CSV-Import (2026-10-16)

Eine Kampagne ist eine schlichte Gruppe (`campaigns`, `prospects.campaign_id`, nullable). Löschen lässt
Kunden und Briefe bestehen. Der Import liest CSV mit Semikolon, Komma oder Tab (Trennzeichen aus der
Kopfzeile), ordnet Spalten über deutsche und englische Aliasse zu, prüft jede Zeile mit denselben
Zod-Schemas wie das Formular und überspringt Firmen, die es am selben Ort schon gibt. Höchstens 2.000
Zeilen pro Datei.

## ADR-0040 · Definitionen der Auswertung (2026-10-16)

Gezählt werden nur echte Besuche: Seite geladen (`confirmed_at`), kein Bot, nicht das Gerät des Owners.
„Gelesen“ heißt zwei Minuten sichtbar oder 75 % gescrollt (wie im Score). Kontaktversuch: Klick auf
einen Kanal, Chat-Nachricht oder Rückrufwunsch. Der Funnel betrachtet Kunden, deren erster Brief im
Zeitraum versendet wurde; die Stufen „Kontakt“, „Termin“, „Gewonnen“ stammen aus der Statushistorie im
Audit-Log, damit ein späterer Rückschritt die erreichte Stufe nicht löscht. Trends vergleichen mit der
gleich langen Vorperiode, Quoten in Prozentpunkten. Alle Abfragen laufen als Mandant; die Filter
(Kampagne, Branche, Region als Ort oder PLZ-Anfang, Tag) stehen in der URL. Jedes Diagramm hat eine
Tabellenansicht, jede Ansicht einen CSV-Export.

## ADR-0041 · Karte mit OpenStreetMap und stündlicher Ortssuche (2026-10-16)

Adressen werden über einen neuen `GeocoderPort` verortet: Nominatim in Produktion, ein deterministischer
Fake in Tests. Der stündliche Job fragt höchstens 40 Adressen mit 1,1 s Abstand (Nominatim-Regeln:
1 Anfrage/s, eindeutiger User-Agent, Ergebnisse speichern). Ein Fehlschlag wird ebenfalls gespeichert,
damit eine Adresse nur einmal angefragt wird; eine geänderte Adresse kommt neu in die Warteschlange.
„Jetzt verorten“ fragt sofort bis zu zehn Adressen des eigenen Workspaces. Die Karte (Leaflet, nur im
Browser geladen) zeigt OSM-Kacheln, gefärbt nach Status oder Kontaktabsicht, mit Legende und
Listenansicht. Weil das Cockpit per Client-Navigation wechselt und dabei die CSP der ersten Seite behält,
erlaubt die Cockpit-CSP Bilder und Schriften von `https:` (Kacheln, Aufzeichnungen); die Exposé-Hosts
bleiben bei `'self'`.

## ADR-0042 · Session-Replay nur nach Einwilligung (2026-10-16)

Aus (Standard), bis der Owner es in den Einstellungen einschaltet. Dann fragt das Exposé nach acht
Sekunden mit einem kleinen Hinweis und zwei gleich gestalteten Knöpfen. Vor einem „Ja“ wird nichts
aufgezeichnet und nichts nachgeladen. Jede Entscheidung landet mit Textversion in `consents` und als
Event in der Timeline. Der Browser merkt sich nur die Entscheidung (`localStorage`, ohne Kennung; das ist
für die Funktion nötig), nie eine ID. rrweb maskiert alle Eingaben; Chat und Rückrufformular sind
komplett ausgeblendet. Die Aufzeichnung geht in Stücken an `/t/replay`, wird gzip-komprimiert unter
`<workspace>/replays/<id>/<n>.json.gz` gespeichert und ist pro Besuch begrenzt (400 Stücke, 8 MB). Ein
Widerruf über „Aufzeichnung läuft · beenden“ löscht sie sofort, der stündliche Job nach
`retention.replaysDays` (Standard 90 Tage). Das Cockpit spielt Aufzeichnungen mit dem rrweb-Replayer in
einem Frame ohne Skripte ab.
