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

Nachtrag 2026-10-16: Trotz Betrieb auf Node (ADR-0047) erneut geprüft. `proxy.ts` baut mit Next und
OpenNext, vergrößert den Worker aber von 2784 auf 3225 KiB (gzip) und reißt damit die Grenze der CI
(2900 KiB, ADR-0035). Solange der Cloudflare-Weg als Rückfall offen bleiben soll, bleibt es bei
`middleware.ts`.

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

## ADR-0043 · Aufbewahrung, Sperrvermerk und Datenexport (2026-10-16)

Der stündliche Job löscht pro Workspace Rohereignisse (`events`) nach `retention.eventsDays` (Standard
365). Besuche bleiben als Zählung für die Auswertung; sie enthalten keine IP-Adresse. Ein Sperrvermerk
(`doNotContactAt`, per „Kein Interesse“ im Exposé oder von Hand auf der Kundenseite) sperrt Briefe; nach
`retention.optOutTrackingDays` (Standard 30) löscht der Job Besuche, Ereignisse, Einwilligungen,
Aufzeichnungen samt Dateien und den Score und setzt `trackingPurgedAt`. Chats und Rückrufwünsche bleiben
als Schriftverkehr, nur ohne Verweis auf den gelöschten Besuch. Außerdem entfernt der Job abgelaufene
Anmeldelinks, Sitzungen und Rate-Limit-Zähler. Export pro Kunde und pro Workspace sind JSON-Dateien aus
allen Tabellen mit `workspace_id`, als Tenant gelesen; Token-Hashes und verschlüsselte Zugangsdaten
fehlen. Der Workspace-Export wird tabellenweise gestreamt. Das Löschen eines Workspace (nur Owner,
Bestätigung durch Eingabe des Kurznamens) entfernt zuerst alle Dateien unter `<workspace_id>/`
(`StoragePort.deletePrefix`), dann die Zeile; alles andere folgt per Cascade. Es läuft auf der
System-Verbindung wie das Anlegen. Auch beim Löschen eines Kunden werden die Aufzeichnungsdateien jetzt
mit entfernt.

## ADR-0044 · Fehler-Monitoring ohne SDK, nur Routenmuster (2026-10-16)

Server-Fehler meldet `src/instrumentation.ts` (`onRequestError`, nur Node-Laufzeit) über den
`MonitorPort` (`@/infra`). Mit `SENTRY_DSN` schickt `src/infra/sentry/monitor.ts` einen Sentry-Envelope
per `fetch` an das Projekt (Region EU, `ingest.de.sentry.io`); ohne DSN schreibt `consoleMonitor` ins Log.
Kein Sentry-SDK: es würde den Worker über das Größenlimit des Gratis-Plans heben (ADR-0035), und wir
brauchen nur Ausnahme, Stack und Kontext. Gesendet werden Fehlertyp, Nachricht, Stack, HTTP-Methode und
das Routenmuster (`/sites/[host]/[slug]`), nie der konkrete Pfad, Query, Header, Cookies, IP-Adressen oder
Nutzerdaten. Fehler beim Senden werden verschluckt, damit Monitoring nie eine Antwort bricht. Browser-
Fehler werden nicht erfasst. Außerdem vergleicht `/api/jobs/hourly` das Cron-Secret jetzt in konstanter
Zeit.

## ADR-0045 · Einstellungen → System und Rechtstexte (2026-10-16)

Die Karte „System und Limits“ zeigt jedem Workspace veröffentlichte Exposés, Besuche im Monat (ohne Bots
und eigene), Mitglieder und Speicher (Summe aus `assets.bytes` und `session_replays.bytes`) gegen
`entitlements()`; heute alles unbegrenzt. Die Werte der Installation (Datenbankgröße per
`pg_database_size`, Dateispeicher gesamt, Anfragen und CPU-Zeit p99 von heute) sehen nur Betreiber:
Konten aus `PLATFORM_ADMIN_EMAILS` oder `platform_admins`. Niemand wird automatisch Betreiber. Anfragen
und CPU-Zeit kommen über den `HostingMetricsPort` aus der GraphQL-Analytics-API von Cloudflare, nur wenn
ein Token gesetzt ist; ein Fehler blendet die Zeilen aus statt die Seite zu brechen. Verglichen wird mit
den Grenzen der Gratis-Pläne (100.000 Anfragen pro Tag, 10 ms CPU, 500 MB Datenbank, 10 GB R2) oder,
mit `HOSTING_PLAN=paid`, der bezahlten Pläne. Ab 80 % erscheint „Über 80 %“, ab 100 % „Limit erreicht“,
jeweils mit Symbol und Text. Impressum und Datenschutzerklärung sind in den Einstellungen als Markdown
bearbeitbar; leer bleibt der aus den Angaben erzeugte Text, der jetzt auch Messwerte, Score, Chat,
Speicherdauer und Dienstleister nennt und die eingestellten Fristen einsetzt.

## ADR-0046 · Exposés weiter pro Aufruf gerendert, Betrieb auf Workers Paid (2026-10-16, abgelöst durch ADR-0047)

Gemessen mit `next start` (Node, Produktions-Build): ein Exposé-Aufruf kostet rund 33 ms CPU, eine
schlichte Seite wie das Impressum rund 15 ms. Der Gratis-Plan von Cloudflare erlaubt 10 ms. Vorrendern
ginge nur über Next-ISR mit OpenNext-Cache (R2, dazu D1 und eine Queue für die Invalidierung): Seiten aus
dem Cache können keine Nonce tragen, die CSP für Exposés würde also schwächer, und „offline nehmen“ wirkte
erst nach der Invalidierung. Entscheidung: ADR-0012 bleibt, für den Betrieb wird Workers Paid empfohlen
(5 $ im Monat, 30 s CPU). Das Vorrendern steht unter „Später“, falls der Gratis-Plan Pflicht wird.
Einstellungen → System zeigt die CPU-Zeit pro Anfrage gegen die Grenze des gewählten Plans.

## ADR-0047 · Betrieb auf eigenem Server (Hetzner + Coolify) statt Cloudflare Workers (2026-10-16, Anbieter und Zugang abgelöst durch ADR-0052)

Der Owner will günstig und planbar prototypen; ein Server mit festen Kosten (etwa 5 €/Monat) trägt
mehrere Projekte, ohne Kontingente, CPU-Grenzen pro Anfrage oder pausierende Datenbanken. Aquisiteur
läuft dort mit `HOSTING_PROFILE=node` als eine Next.js-Instanz, gebaut von Coolify mit Nixpacks
(`nixpacks.toml`), Postgres 16 als Coolify-Ressource auf demselben Server mit täglichem Backup nach R2,
Dateien weiter in R2. Live-Chat und Live-Feed laufen aus dem Prozess (`REALTIME_PROVIDER=memory`), was
genau eine Instanz voraussetzt. Der stündliche Job ist eine geplante Aufgabe in Coolify
(`pnpm jobs:hourly`); `tsx` und `dotenv` sind deshalb Laufzeit-Abhängigkeiten, ebenso für die
Migrationen beim Start (`pnpm db:migrate && pnpm start`). `/healthz` antwortet auf jedem Host, sobald die
Datenbank erreichbar ist, damit Coolify erst dann umschaltet. Die Cloudflare-Variante bleibt im Code und
in der CI (Größen-Check) erhalten, Anleitung in `docs/DEPLOY_CLOUDFLARE.md`. Damit ist die Frage aus
ADR-0046 (Workers Paid oder Vorrendern) für den Betrieb hinfällig. Einstellungen → System vergleicht mit
`HOSTING_PLAN=vps` (20 GB Datenbank, 10 GB R2, keine CPU-Grenze pro Anfrage).

## ADR-0048 · Root-404 ohne `next/link` (2026-10-16)

Die Root-Grenze `src/app/not-found.tsx` steckt in der Antwort jeder Seite, auch jedes Exposés. Ihr
`next/link` ist eine Client-Komponente, und Next lud dafür die Chunk-Gruppe der Cockpit-Startseite mit
(Zod, Realtime, Buttons; etwa 37 KB gzip), sodass die Lighthouse-Leistung der Exposés um 0,9 pendelte.
Der Link „Zur Startseite“ ist deshalb ein einfaches `<a>`; eine 404 braucht keine Client-Navigation.
Der E2E-Test des öffentlichen Exposés prüft, dass kein Cockpit-Chunk geladen wird.
Aus demselben Grund formatiert der Preisrechner Euro-Beträge mit `formatEuro()` statt `Intl.NumberFormat`
(der erste Intl-Formatierer lädt Locale-Daten, gedrosselt etwa 60 ms mitten in der Hydration), und
Client-Komponenten des Exposés verwenden `clsx` statt `cn`, damit tailwind-merge (9 KB gzip) erst mit
der nachgeladenen Kontaktebene kommt.

## ADR-0049 · Dateien auf dem eigenen Server statt in R2 (2026-10-16, für den Betrieb abgelöst durch ADR-0052)

Der Owner will die Daten selbst hosten. Bilder, Videos und Aufzeichnungen liegen deshalb mit
`STORAGE_PROVIDER=local` in einem Coolify-Volume (`LOCAL_STORAGE_DIR=/data/files`) auf demselben Server
wie App und Datenbank. Der bisherige Entwicklungs-Adapter wird dafür zum regulären Adapter
(`src/infra/disk/storage.ts`) und schreibt jede Datei über eine temporäre Datei plus Umbenennen, damit
kein Leser eine halbe Datei sieht. Gesichert wird über das tägliche Hetzner-Backup der ganzen Platte, das
Volume und die Datenbank-Dumps von Coolify mitnimmt; eine Kopie außer Haus (S3, `rclone`) ist optional.
S3 bleibt per Konfiguration möglich und ist auf Cloudflare Pflicht. E-Mail bleibt bei Resend: Hetzner
sperrt Port 25 bei neuen Konten, und Mails von einer frischen Server-IP landen oft im Spam. Der Server
braucht mindestens 2 vCPU, 4 GB RAM und 40 GB SSD; die Anleitung nennt bewusst keinen Typnamen, weil
Hetzner Typen und Preise ändert.

## ADR-0050 · Gestaltungsstile für Exposés (2026-10-16)

Akzentfarbe und Logo allein ließen jedes Exposé wie dasselbe Magazin aussehen. `theme.style` wählt
deshalb einen von drei Stilen: `editorial` (bisheriges Aussehen, Standard), `bold` (Neo-Brutalismus:
keine Rundungen, 2-px-Linien, harte versetzte Schatten, Anton in Versalien) und `soft` (große Radien,
weiche Schatten, cremige Flächen, Nunito in den Überschriften). Das Feld ist optional, deshalb bleibt
`schemaVersion` 1. Die Flächen- und Textfarben jedes Stils kommen aus `styleScheme()` in
`src/domain/expose/theme.ts`, damit die Akzentkorrektur gegen die richtigen Flächen rechnet; ein
Unit-Test prüft alle `contrastPairs` je Stil in hell und dunkel. Formen, Schatten und Schrift setzt
`globals.css` unter `[data-expose-style]`. Die beiden zusätzlichen Schriften (Anton 19 KB, Nunito
17 KB, nur der Schnitt 800) liegen unter `public/fonts/expose/` und gelten nur für Überschriften. Jedes Exposé lädt per
`<link rel="preload">` im Seitenkopf nur die Schrift seines Stils vor; mit `next/font` würden alle
Schriften auf jedem Exposé vorgeladen. Ohne Vorladen kam die Schrift erst nach dem ersten Zeichnen,
Text brach um und das Heldenbild sprang (CLS bis 0,06 in Lighthouse CI, Grenze 0,02).
Bewusst kein freies CSS oder freie Schriftwahl im JSON: drei geprüfte Stile bleiben barrierefrei und
schnell.

## ADR-0051 · Arbeitsumgebung für Claude Code im Repo (2026-10-19)

Nach den Best Practices von Anthropic für Claude Code liegen Regeln, die immer gelten müssen, als Hooks
in `.claude/settings.json` statt als Bitte in `CLAUDE.md`: Ein SessionStart-Hook richtet Cloud-Sessions
ein (Abhängigkeiten, Postgres mit den drei Datenbanken, `.env`), damit jeder Thread sofort testen kann;
ein PostToolUse-Hook formatiert jede bearbeitete Datei mit Prettier. Wissen, das nur manchmal gebraucht
wird, steht in Skills (`.claude/skills/`: `steward`, `expose-authoring`, `backlog`), damit `CLAUDE.md`
kurz bleibt. Der Agent `spec-reviewer` prüft einen Diff in frischem Kontext gegen ZIELPROMPT und die
Architekturregeln, bevor ein Feature als fertig gilt. Lokal tut der SessionStart-Hook nichts.

## ADR-0052 · Betrieb auf Mikrus 3.5 hinter Cloudflare, Dateien in R2 (2026-10-19, ersetzt Teile von ADR-0047 und ADR-0049)

Der Owner betreibt Aquisiteur auf einem **Mikrus 3.5** (4 GB RAM, 40 GB Platte, etwa 45 € im Jahr;
Rechenzentrum bei Hetzner in Helsinki, Finnland) statt auf einem eigenen Hetzner-Server; der Preis wiegt
für Prototypen schwerer als die einfachere Einrichtung. Von ADR-0047 bleibt alles: Coolify, Nixpacks,
`HOSTING_PROFILE=node`, eine Instanz, Postgres 16 als Coolify-Ressource auf demselben Server. Die
geteilte 300-MB-Datenbank von Mikrus passt nicht, weil die Migrationen eine eigene Rolle anlegen
(`drizzle/0000_roles_and_functions.sql`). Mit 2 GB RAM (Mikrus 3.0) bricht der Build ab.

Mikrus gibt keine eigene IPv4-Adresse, die Ports 80 und 443 gibt es nur über IPv6. **Cloudflare steht
deshalb vor allen Domains** (AAAA-Einträge mit Proxy, SSL „Full (strict)“) und ist damit Pflicht statt
optional. Das TLS-Zertifikat zwischen Cloudflare und Server ist ein Cloudflare-Origin-Zertifikat für
`<domain>` und `*.<domain>`, das Traefik in Coolify ausliefert; Let's Encrypt in Coolify entfällt. Die
App vertraut ohnehin zuerst `cf-connecting-ip` und liest die Stadt aus `cf-ipcity` (Managed Transform
„Add visitor location headers“). Eigene Domains von Workspaces (§9a) müssen damit ebenfalls über
Cloudflare laufen, später über Cloudflare for SaaS.

Ein Platten-Backup per Klick gibt es bei Mikrus nicht. Die täglichen Datenbank-Dumps von Coolify gehen
deshalb in einen R2-Bucket (`aquisiteur-backups`, Jurisdiktion EU), und **Bilder, Videos und
Aufzeichnungen liegen in R2** (`STORAGE_PROVIDER=s3`, Bucket `aquisiteur-files`, Endpunkt
`https://<account-id>.eu.r2.cloudflarestorage.com`) statt im Volume aus ADR-0049. Das schont die
40-GB-Platte, und kein Teil der Daten hängt allein an diesem Server. Das Volume bleibt per Konfiguration
möglich, etwa auf einem Server mit Platten-Backup.

Offen und bewusst später: Der Server ist über IPv6 auch direkt erreichbar, an Cloudflare vorbei. Dann
ließe sich `cf-connecting-ip` fälschen und die Kurzlink-Sperre umgehen. Abhilfe wäre, 80 und 443 nur für
die IP-Bereiche von Cloudflare zu öffnen oder Authenticated Origin Pulls einzuschalten. Die Anleitung
steht in `docs/DEPLOY.md`; die Einrichtung auf einem Server mit eigener IPv4 (z. B. Hetzner) ist dort als
Abweichung beschrieben.

## ADR-0053 · App-Image auf GitHub bauen für Server mit wenig RAM (2026-10-19, ergänzt ADR-0047)

Auf einem Testserver mit 1 GB RAM bricht der Nixpacks-Build in Coolify ab: Coolify und Postgres belegen
gut die Hälfte, `next build` braucht allein mehr als 1 GB, und der Server hat keinen Swap. Ein
`Dockerfile` baut die App deshalb auf GitHub (`.github/workflows/image.yml`, bei jedem Push auf `main`
und von Hand), legt das Image privat unter `ghcr.io/tsh3rr/aquisiteur` ab, und Coolify startet es als
Ressource „Docker Image“. Optional löst der Workflow über den Deploy-Webhook von Coolify das Deployment
aus (Secrets `COOLIFY_WEBHOOK`, `COOLIFY_TOKEN`). Der Start ist derselbe wie mit Nixpacks: erst
`scripts/migrate.ts`, dann `next start`; die laufende App braucht rund 100 MB.

Nur das Schema von `APP_URL` wirkt beim Build (HSTS-Header in `next.config.ts`); das Image wird mit
`https` gebaut und ist sonst unabhängig von Domain und Workspace, alles Übrige liest die App zur
Laufzeit. Nixpacks bleibt der Weg für Server mit genug Speicher, wie den Mikrus 3.5.

Nachtrag: Das Image enthält nur Laufzeit-Abhängigkeiten (`pnpm prune --prod`) und keinen Build-Cache, etwa
1,4 GB statt 2,5 GB. `next.config.ts` lädt `@opennextjs/cloudflare` deshalb nur bei Bedarf. Skripte mit
`sharp` (`expose:publish`) laufen auf dem eigenen Rechner, auf 1 GB RAM bräche die Bildoptimierung ohnehin ab.

## ADR-0054 · Docker Compose statt Coolify auf sehr kleinen Servern (2026-10-19, ergänzt ADR-0053)

Auch ohne Build hielt Coolify auf dem Testserver mit 1 GB RAM nicht durch: Oberfläche, Warteschlange,
Redis, eigene Datenbank und Traefik belegen allein gut 500 MB, und nach einigen Stunden hing Docker. Für
solche Server gibt es `deploy/compose.yml`: Postgres 16 und das App-Image von GitHub (ADR-0053), rund
150 MB zusammen. Ohne Proxy, weil Mikrus HTTPS übernimmt und auf Port 80 weiterleitet; der stündliche
Job und ein tägliches `pg_dump` laufen per Cron auf dem Server, Updates per `docker compose pull`.
Anleitung in `docs/DEPLOY_COMPOSE.md`. Für den echten Betrieb bleibt Coolify mit Cloudflare und R2
(ADR-0052) der Weg, weil es Backups nach R2, Logs und Deployments per Oberfläche mitbringt.

Nachtrag: Updates laufen automatisch. Nach einem gebauten Image meldet sich der Workflow „Image“ per SSH
auf dem Server an und führt `docker compose pull` und `up -d` aus (Secrets `DEPLOY_SSH_KEY`,
`DEPLOY_HOST`, `DEPLOY_PORT`, optional `DEPLOY_KNOWN_HOSTS`). Der Schlüssel ist in `authorized_keys` auf
genau diesen Befehl beschränkt. Die Concurrency-Gruppe bricht einen laufenden Durchgang ab, sobald ein
neuerer Commit auf `main` landet, sodass mehrere Merges kurz hintereinander nur ein Image und ein
Deployment ergeben. Nur Standard-SSH, kein Dienst eines Anbieters.

## ADR-0055 · Brief mit Exposé-Vorschau als zweite Seite (2026-10-20, ergänzt ADR-0037)

Der Brief zeigt schon auf Papier, was hinter dem QR-Code wartet (§7.9 „Exposé-Vorschau im Brief“), und
sieht dabei nach Gestaltung aus, nicht nach Geschäftsbrief. Seite 1 bleibt das DIN-5008-Anschreiben,
bekommt aber weiche Kreisformen am Rand (außerhalb von Fenster und Infoblock), den Betreff in der
Headline-Schrift des Exposé-Stils und statt der QR-Box eine Karte „Mein Vorschlag für Ihre Website“
(Kurzlink links, gepunkteter Code rechts) und einen dicken Pfeil „Bitte umblättern“. Seite 2 ist die
Vorschau: Headline, Vorher/Nachher als zwei gleich große Handys (links die heutige Seite verkleinert,
rechts der Vorschlag), drei Ideen mit großen Ziffern und unten dieselbe helle Karte wie auf Seite 1:
„Alles Weitere auf dieser Seite“, Kurzlink, Code und Kontakt des Owners.

Gestaltungsregeln aus der Abstimmung mit dem Owner: Show, don't tell (Link, Nummer und Mail erklären
sich selbst, nur der Code bekommt ein kleines „Scannen“); alles aufrecht, nichts gekippt, weil gedrehte
Raster und feine Punkte im Druck unscharf werden; Labels immer zentriert über oder unter ihrem Element.

- Inhalte kommen automatisch aus `hero`, `before_after` und `proposal` (ersatzweise `findings`), reine
  Logik in `src/domain/letters/teaser.ts`. Für die Handys bekommt `before_after` die optionalen Felder
  `afterMobile` und `beforeMobile`; `letter.teaser` überschreibt einzelne Felder. Beides additiv,
  Schema-Version bleibt 1.
- Farben leiten sich wie im Exposé aus der Akzentfarbe ab (`deriveAccent`, hell) und werden nach dem
  Runden auf Hex noch einmal auf 4,5:1 geprüft. Headline-Schriften wie im Exposé (Instrument Serif,
  Anton, Nunito), für React-PDF als WOFF unter `public/fonts/letter/`.
- Der Code auf dem Brief: Punkte statt Quadrate, runde Ecken-Augen in der Akzentfarbe und ein Punkt in
  der Akzentfarbe in der Mitte, deshalb Fehlerkorrektur H. Hat der Workspace ein Logo, steht es einfarbig
  im Punkt (im Browser auf die Akzentfarbe umgefärbt, `src/domain/letters/tint.ts`, als JPEG wie alle
  Briefbilder). Logos mit Transparenz zählen über den Alphakanal, deckende über ihre Helligkeit; breite
  Wortmarken (Seitenverhältnis über 2,2) bleiben draußen, weil sie bei 5 mm unleserlich wären. Früher
  stand dort ein „Hi!“, das nichts sagte. Die codierte URL ändert sich nicht. Der QR-Code im Exposé-PDF bekommt den reinen Punkt. Das Label „Scannen“ steht unter dem Code, außerhalb der Module. Mit einem
  QR-Decoder bei 100 dpi geprüft, für alle drei Stile.
- Pro Brief abschaltbar (`letters.options.teaser`, Standard an). Ältere Briefe ohne das Feld drucken
  mit Vorschau. Die Seite zeigt immer die aktuelle Exposé-Version.
- Bilder: Exposé-Bilder liegen nur als WebP/AVIF vor, React-PDF bettet nur PNG und JPEG ein. Der
  Browser, der das PDF ohnehin rendert, wandelt sie per Canvas in JPEG (bis 1600 px). PNG wird bewusst
  vermieden, auch für Logo und Unterschrift: React-PDF entpackt PNGs in einem Blob-Worker, den die CSP
  (`worker-src 'self'`) blockiert, und das PDF würde nie fertig. JPEG auf Weiß verliert nichts, das
  Logo steht deshalb auf einem weißen Chip.
- Briefkopf auf Seite 1: Logo der Agentur (`branding.logoAssetId`) oben links in der Briefkopfzone,
  ohne Logo der Name in der Headline-Schrift. Links, damit es nie mit der Kreisform oben rechts
  kollidiert. Der Absenderblock (Firma, Name, Kontakt, Datum) beginnt bündig mit der Rücksendezeile.
- Telefon und E-Mail des Absenders in der Karte auf Seite 2, mit kleinen Symbolen, pro Brief abschaltbar
  (`letters.options.contact`, Standard an, fehlt bei älteren Briefen und gilt dann als an).

## ADR-0056 · App-Icons als PNG und Safe Areas im Cockpit (2026-10-20)

- Icons: `pnpm icons:build` rendert aus dem Favicon-Glyph eigene PNGs nach `public/icons/`:
  `apple-touch-icon.png` (180 px, randlos, iOS rundet selbst und zeigt es auch bei Push-Nachrichten),
  Manifest-Icons 192/512 (`any`) und 512 `maskable`, dazu `badge-96.png` als weiße Silhouette für die
  Android-Statusleiste. Das SVG bleibt Favicon. Nur Cockpit, Login und Onboarding verlinken Manifest
  und Touch-Icon (`src/app/installable-app.ts`), Exposé-Hosts nie.
- iOS übernimmt ein neues Touch-Icon erst, wenn die App vom Home-Bildschirm entfernt und neu
  hinzugefügt wird.
- Das Cockpit-Layout setzt `viewport-fit=cover`, sonst meldet iOS alle `env(safe-area-inset-*)` als 0
  und die untere Leiste läuft in die Displayrundung und unter den Home-Indikator. Die Leiste hält
  seitlich mindestens 0,75 rem Abstand. Das Root-Layout (Exposés) bleibt unverändert.
- Ein Seitenraster direkt in `#main` hat eine Spalte `minmax(0, 1fr)` (globals.css), damit breite
  Tabellen und Filterzeilen die Seite auf dem Handy nicht verbreitern. Scroll-Container um Tabellen
  sind `relative`, sonst ziehen absolut positionierte `sr-only`-Texte die Seite breiter.
- Das öffentliche Exposé (`/x/<slug>`) setzt ebenfalls `viewport-fit=cover`. Kontaktleiste, Chat-Knopf,
  Chat-Eingabe und Aufzeichnungs-Knopf rücken um die Safe Areas ein, der Inhalt seitlich im Querformat.

## ADR-0057 · Staging bekommt jeden Merge, Produktion nur Freigaben (2026-10-20, ergänzt ADR-0054)

Seit Updates automatisch laufen, geht jeder Merge sofort live. Vor dem Go-live trennen wir deshalb:
Staging bekommt jeden Merge (`image.yml`, Job „Deploy to staging“, Secrets `DEPLOY_*`), Produktion nur,
was der Owner freigibt. Jede Umgebung ist ein eigenes Compose-Projekt mit eigener Datenbank, eigenen
Dateien und eigenen Subdomains. Ob auf einem Server (mit `COMPOSE_PROJECT_NAME` und `APP_PORT`
nebeneinander, rund 300 MB für beide) oder auf zwei, entscheiden nur die Secrets; getrennte Server
sind sicherer, weil ungeprüfter Staging-Code dann weder Docker noch Speicher mit Produktion teilt. Die
Wahl fällt beim Go-live, ein späterer Umzug braucht keine Code-Änderung.

- `release.yml` läuft bei einem Tag `v*` oder per Hand auf `main` beziehungsweise einem Tag (auch aus
  der GitHub-App). Er baut das Image für genau diesen Commit aus dem Cache, gibt ihm die Namen
  `production`, den Commit-Hash und gegebenenfalls den Tag und deployt per SSH (Secrets
  `PROD_DEPLOY_*`, eigener Schlüssel, auf den Produktionsordner beschränkt). Ein älterer Tag ist der
  Rollback.
- Der Produktionsserver lädt `APP_IMAGE=…:production` statt `latest`; die Freigabe ist also der
  Wechsel dieses Namens. Neu bauen statt umtaggen, weil der Staging-Build eines Commits abgebrochen
  sein kann, wenn kurz danach ein neuerer gemergt wurde.
- Getrennte Secret-Namen statt GitHub Environments: Environments mit Secrets gibt es in privaten Repos
  nur ab GitHub Pro, und ein gleichnamiges Secret würde bei fehlendem Environment still auf Staging
  zeigen. Ohne `PROD_DEPLOY_*` wird kein Server angefasst.
- Beide Deploy-Jobs teilen sich `.github/actions/compose-deploy`. Freigaben laufen nacheinander
  (`cancel-in-progress: false`), Staging-Builds brechen sich weiter gegenseitig ab.

## ADR-0058 · Rückruf-Formular mit bekannter Nummer (2026-10-20)

- Quellen: Telefonnummer des Kunden (`prospects.phone`), danach die Nummern seiner Ansprechpartner
  (`contacts.phone`, Hauptkontakt zuerst). Doppelte Nummern (auch +49 und 0 gemischt) erscheinen einmal,
  höchstens drei. Separate Handy- oder WhatsApp-Felder gibt es in den Stammdaten nicht.
- Das Exposé bekommt nur die maskierte Form („+49 170 ••• 67“: Ländervorwahl, drei Ziffern, letzte zwei)
  und einen Verweis (`p` oder die Kontakt-ID). Ein Klick auf „… verwenden?“ setzt den Verweis, das
  Formular schickt `phoneRef` statt `phone`. Der Server sucht die Nummer erneut, nur beim Kunden dieses
  Exposés und nur, solange die Einstellung an ist; sonst muss der Besucher die Nummer eintippen.
- Einstellung: Einstellungen → Kontakt und Chat → „Bekannte Nummer anbieten“
  (`chat.prefillCallbackPhone`, Standard an). Sie liegt im `chat`-JSON, weil sie im selben Formular
  gespeichert wird; so braucht es keine Migration.

## ADR-0059 · Exposé als gestaltetes PDF (2026-10-20, ergänzt ADR-0037)

- Wie die Briefe rendert `@react-pdf/renderer` das PDF im Browser (`src/components/expose-pdf/`), erst beim
  Klick nachgeladen und per Alias aus dem Server-Bundle gehalten. Die Daten baut `printableExpose()`
  (`src/server/exposes/print.ts`) aus denselben Daten wie die Seite: Blöcke, Bild-URLs, Farben
  (`printColors`, wie die Teaser-Seite), Kanäle des Owners.
- Aufbau: Titelseite (Hero, Bild oder Inhaltsübersicht, Owner, Referenz), danach alle Blöcke fließend mit
  Fußzeile „Seite x von y“, Kontakt mit QR-Code und Link zum Exposé (ohne Kontaktblock wird er angehängt).
  Titel bleiben mit dem ersten Inhalt zusammen, damit keiner allein unten auf einer Seite steht. Interaktive
  Teile werden statisch: Preise als Liste mit Summe, Video als Hinweis, CTA als Farbband.
- Cockpit: Exposé-Seite → „Als PDF herunterladen“ für die angezeigte Version, Link nur, solange das Exposé
  online ist. Exposé: „Als PDF speichern“ holt `/x/<slug>/pdf` (nur, was die Seite ohnehin zeigt) und nimmt
  die Preisauswahl des Lesers mit; schlägt etwas fehl, öffnet die Druckansicht wie bisher.
- Dafür erlaubt die CSP der Exposé-Hosts jetzt `'wasm-unsafe-eval'` und `connect-src data:` wie das
  Cockpit. Kein JS-`eval`; der Code lädt nur bei Klick, Lighthouse bleibt unberührt.
- Dateiname in ASCII („Expose Cafe Mueller.pdf“): Chromium verwirft den Namen eines Blob-Downloads mit
  Umlauten und speichert dann „download“.
- Die Fußzeile steht per `top` statt `bottom`: mit der Zeilenhöhe der Seite fällt eine an `bottom`
  verankerte, wiederholte Fußzeile in React-PDF aus der Seite.

## ADR-0060 · Aufgaben und Wiedervorlagen (2026-10-20)

- Tabelle `tasks` je Prospect: Fälligkeit als lokales Kalenderdatum (`due_date`) plus optionale Uhrzeit
  (`due_time`, „14:00“), damit „Freitag anrufen“ ohne Uhrzeit den ganzen Tag fällig bleibt und erst
  danach überfällig wird. Erinnerungsart (`reminder`: keine, zur Fälligkeit, 1 Stunde vorher, am Vortag)
  wird beim Speichern in der Zeitzone des Workspaces zu `remind_at`; ganztägige Aufgaben erinnern um
  8:00. Liegt der Zeitpunkt beim Speichern schon zurück, gilt die Erinnerung als erledigt (kein Ping
  beim Anlegen). Ein neues Datum setzt sie zurück.
- Versand im stündlichen Job (`runTaskReminders`): Aufgabe erst per `reminded_at` beanspruchen, dann
  benachrichtigen, so erinnert ein doppelter Lauf nie zweimal. Eine Erinnerung für 9:00 kommt beim
  Cron `5 * * * *` um 9:05; feiner wird es nur mit einem häufigeren Aufruf desselben Endpunkts.
- Benachrichtigung mit Trigger `task_due`, Tippen öffnet `/kunden/<id>#aufgabe-<id>` (hervorgehoben
  per `:target`). Erinnerungen sind pro Aufgabe gewünscht und brauchen deshalb keine Regel: ohne
  `task_due`-Regel gehen sie per Push und E-Mail raus (`TASK_REMINDER_FALLBACK`), eine Regel ändert
  Kanäle und Ruhezeiten, eine abgeschaltete Regel stellt sie ab. Kein Backfill, weil der neue
  Enum-Wert in derselben Migrations-Transaktion nicht nutzbar wäre.
- „Heute“ zeigt Überfälliges und heute Fälliges, `/aufgaben` alles offene über alle Kunden; die
  Tageszusammenfassung nennt die Zahl der heute fälligen Aufgaben. Aufgaben gehören zum
  Prospect-Export und werden mit dem Prospect gelöscht.

## ADR-0061 · Globale Suche, Command Palette und Tastaturkürzel (2026-10-20)

- Eine Palette für Suche und Befehle (§7.8): ⌘K / Strg+K überall, „/“ außerhalb von Textfeldern, auf
  dem Handy ein Suchknopf im Kopf, am Desktop ein Suchfeld in der Seitenleiste. Radix Dialog sorgt für
  Fokusfalle, Escape und Fokus-Rückgabe (beim Tippen auf iOS bekommt der Knopf keinen Fokus, daher gibt
  die Palette ihn ausdrücklich zurück).
- Muster: ARIA-Combobox mit `aria-activedescendant`, Treffer als `listbox` mit Gruppen (Kunden, Exposés,
  Kampagnen, Seiten, Aktionen), Trefferzahl über eine `status`-Region.
- Datensätze sucht `searchWorkspace()` (`src/server/search.ts`) als Tenant, also unter RLS und zusätzlich
  mit `workspace_id`-Filter: Firma, Ort, Branche, E-Mail, Telefon, Schlüssel und Ansprechpartner,
  Exposé-Titel und Ref-Code, Kampagnenname. Umlaute werden in SQL gefaltet (ä = ae = a), ohne
  `unaccent`-Extension, damit es reines Postgres bleibt. Bei Hunderten Kunden je Workspace reicht ein
  Scan; ein Trigramm-Index folgt erst, wenn es spürbar langsam wird.
- Befehle und Kürzel stehen zentral in `src/domain/search.ts` (`COMMANDS`). Folgen wie „G K“ statt
  Einzeltasten mit Modifikator, weil Browser die meisten Strg-Kombinationen belegen.
- WCAG 2.1.4: Kürzel aus einzelnen Zeichen („/“, „?“, „G K“) lassen sich in der Kürzel-Übersicht („?“)
  pro Gerät abschalten (localStorage). ⌘K / Strg+K bleibt immer aktiv. In Eingabefeldern und Dialogen
  greifen Einzeltasten nie.
- Aufgaben und Wiedervorlagen (ADR-0060) sind eine eigene Treffergruppe; offene zuerst, nach Fälligkeit.
- Noch offen: Kürzel für Aktionen auf der Kundenseite (Notiz, Status ändern, Anrufen) und in der
  Kundenliste (Sammelaktionen). Sie brauchen Befehle, die vom Kontext der Seite abhängen; das kommt
  mit einer Erweiterung der Palette um seitenbezogene Befehle.

## ADR-0062 · Automatische Folgebriefe beim Selbstdruck (2026-10-21)

- §7.9 sah den automatischen Follow-up-Versand erst mit einem echten Druck-Provider vor. Er ist jetzt
  schon mit `manual` aktiv, weil die App dabei nichts verschickt: Sie legt einen Folgebrief als Entwurf
  an (eigener Touchpoint und QR-Code wie beim Folgebrief von Hand) und eine Aufgabe „Folgebrief drucken
  und versenden“, die sofort erinnert (`remind_at` = jetzt, im selben stündlichen Lauf vor den
  Aufgaben-Erinnerungen). Mit einem echten Provider wird daraus später „einreihen“ statt „Entwurf“.
- Regel rein in `src/domain/letters/follow-up.ts`: fällig, wenn ein erster Brief seit `afterDays`
  (Standard 14, einstellbar 3 bis 90) versendet ist und es seitdem keinen echten Besuch des Prospects
  gab (bestätigt, kein Bot, nicht intern, wie „Zeit bis zur Öffnung“). Briefe, die länger als `afterDays` + 14 Tage zurückliegen,
  bleiben unberührt, damit Einschalten oder ein ausgefallener Cron keine Flut alter Folgebriefe erzeugt.
- Ausschlüsse stehen in der SQL-Abfrage, nicht erst im Code: Der Prospect muss noch im Status
  „Brief versendet“ stehen (wer geöffnet, gesprochen, „Kein Interesse“ gesagt, gewonnen oder verloren
  hat, bekommt keinen „Vielleicht ist der Brief untergegangen“-Brief), dazu kein Besuch, kein
  Sperrvermerk, kein Folgebrief und die Regel im Workspace an. So verdrängen dauerhaft ausgeschlossene
  Briefe die fälligen nie aus dem Stapel von 200. Briefe jenseits des Fensters bekommen ebenfalls
  `follow_up_at` und fallen damit heraus.
- Pro erstem Brief höchstens einmal: `letters.follow_up_at` wird beansprucht, bevor der Entwurf
  entsteht. Ein gelöschter Entwurf kommt deshalb nicht wieder, und zwei überlappende Läufe erzeugen nie
  zwei Folgebriefe. Teilindex `letters_follow_up_idx` für die Suche über alle Workspaces.
- Kandidaten liest der Job auf der Systemverbindung; Entwurf und Aufgabe schreibt er per `withTenant`
  als ältester Owner des Workspaces, damit RLS, Audit-Log (`meta.auto`) und Realtime wie bei einer
  Aktion im Cockpit laufen.
- Folgebriefe haben jetzt eine eigene Vorlage (`letter.followUp.subject/body`), die auch für Folgebriefe
  von Hand gilt; vorher nutzten sie die Vorlage des ersten Briefs. Standardmäßig an, abschaltbar unter
  Einstellungen → Briefe → Folgebrief.

## ADR-0063 · Pingen als erster echter Druckdienst (2026-10-21)

- Adapter `src/infra/pingen/letters.ts` hinter `LetterDispatchProvider`. Endpunkte nach Pingens offiziellem
  SDK (pingencom/pingen2-sdk-php), weil die API-Doku selbst nicht maschinell lesbar ist: Token per
  Client Credentials (`identity[-staging].pingen.com/auth/access-tokens`, 12 h, gecacht), `GET /file-upload`
  für eine vorsignierte Upload-Adresse, `POST /organisations/{id}/deliveries/letters/` mit
  `auto_send: true`, `address_position: left` (DIN-5008-Fenster) und Idempotency-Key = Brief-ID, Status per
  `GET …/letters/{id}`, Storno per `PATCH …/cancel`, Preis per `…/price-calculator`. Standardbrief =
  `cheap`, Priorität = `fast`. Gegen echte Server ist das noch nicht gelaufen; die Unit-Tests prüfen
  die Anfragen gegen nachgebaute Antworten.
- Zugangsdaten pro Workspace in `integrations` (`kind = letters.pingen`): IDs im Klartext in `config`,
  Client-Secret und Webhook-Schlüssel AES-GCM-verschlüsselt mit `INTEGRATIONS_ENCRYPTION_KEY`, gebunden an
  `<workspace_id>:letters.pingen`. Secrets werden nie wieder angezeigt; ein leeres Feld behält sie.
  `getInfra().letters(provider, config)` baut den Adapter pro Anfrage aus den entschlüsselten Daten.
- Das PDF entsteht weiter im Browser (React-PDF, ADR-0037): „Per Pingen versenden“ rendert jeden
  Entwurf einzeln, legt ihn unter `<workspace_id>/letters/<id>.pdf` ab (nur Entwürfe, nur echte PDFs,
  höchstens 8 MB) und übergibt dann. Ein Server-Rendering hätte react-pdf in den Worker gezogen.
  Folge: Automatische Folgebriefe (ADR-0062) bleiben auch mit Pingen Entwurf plus Aufgabe; der Owner
  schickt sie mit einem Klick ab.
- Die Aufrufe bei Pingen laufen außerhalb jeder Datenbank-Transaktion: Brief beanspruchen (`queued`,
  committet), senden, Ergebnis in einer zweiten Transaktion festhalten, erst dann das PDF löschen. Ein
  Rollback vergisst so nie einen Brief, den Pingen schon angenommen hat; ein liegengebliebener Anspruch
  wird nach 10 Minuten mit demselben Idempotency-Key erneut gesendet. Lehnt Pingen ab, wird der Brief
  wieder Entwurf mit Grund (`failure_reason`). Lehnt Pingen ein Storno ab (schon im Druck), bleibt der
  Brief, wie er ist, und zählt als abgelehnt.
- Rückmeldungen kommen per Webhook (`/api/webhooks/pingen/<workspace_id>`, Body höchstens 256 KB per
  `readBodyLimited`, HMAC-SHA256 über den Rohtext im Header `Signature`, sonst 401) und als
  Sicherheitsnetz stündlich per Statusabfrage für Briefe, die seit über einer Stunde und unter 60 Tagen
  unterwegs sind; jede Abfrage stellt den Brief hinten an, damit unlösbare Fälle die anderen nicht
  verdrängen. Beides läuft über `recordProviderUpdates`: Zustände dazwischen werden durchlaufen,
  „versendet“ setzt den Prospect auf „Brief versendet“, Pingens Preis ersetzt die Pauschale, doppelte
  oder verspätete Meldungen ändern nichts. Ein `issue` bei einem Brief, den man in Pingen noch
  korrigieren kann (`action_required`), ist nur ein Hinweis am Brief; „fehlgeschlagen“ wird er erst,
  wenn Pingen ihn aufgibt (`invalid`, `unprintable`, `expired`).
- Die Testumgebung von Pingen ist Standard, bis der Owner sie abschaltet. Briefe von dort tragen den
  Provider `pingen-staging`, sprechen auch nach dem Umschalten weiter mit der Testumgebung und enden als
  „storniert“ mit dem Hinweis „Testversand“, sobald Pingen sie als verschickt meldet. So starten sie
  weder „Zeit bis zur Öffnung“ noch Folgebriefe, Kosten oder Nutzungszähler. Die Bestätigung vor dem
  Versand nennt die Testumgebung oder „kostenpflichtig“; einen Preis nennt sie nicht, Pingens Preis
  steht nach dem Versand am Brief. Die generierte Datenschutzerklärung nennt Pingen, solange es
  eingeschaltet ist oder je ein echter Brief darüber ging.
- Pingen-Tokens werden im Speicher nach Umgebung, Client-ID und Secret getrennt gecacht, damit kein
  anderer Workspace mit derselben Client-ID und kein geändertes Secret einen alten Token nutzt.

## ADR-0064 · Vertrauenswürdige Client-Adresse, Origin-Schutz und Grenzen ohne Adresse (2026-10-21, schließt den offenen Punkt aus ADR-0052)

Das Security-Audit vor dem Go-live (ZIELPROMPT §10, §14) hat als hoch eingestuft, dass die App
`cf-connecting-ip` immer glaubte. Der Server ist über IPv6 auch direkt erreichbar, und im heutigen
Betrieb (Docker Compose hinter dem HTTPS-Proxy von Mikrus, ADR-0054, ohne eigenes Cloudflare) kann jeder
Besucher den Header selbst schicken. Damit liefen Kurzlink-Sperre und Rate Limit der Anmeldelinks ins
Leere. Ob Mikrus intern Cloudflare nutzt, ist für die App nicht erkennbar und nicht steuerbar.

- Eine Stelle entscheidet: `src/middleware.ts` setzt pro Anfrage `x-aquisiteur-client-ip` (ein
  mitgeschickter Wert wird überschrieben). Cloudflare-Header gelten nur, wenn jede Anfrage durch
  Cloudflare muss: mit `ORIGIN_SECRET` oder auf Workers. Sonst gilt der letzte Eintrag in
  `x-forwarded-for`, den der Proxy direkt vor der App anhängt, und alle `cf-*`-Header werden verworfen.
  Better Auth liest nur diesen Header. Der Matcher der Middleware schließt Prefetch-Anfragen nicht mehr
  aus, sonst ließe sich all das mit dem Prefetch-Header umgehen.
- `ORIGIN_SECRET` (optional): Eine Transform Rule von Cloudflare fügt jeder Anfrage den Header
  `x-aquisiteur-origin` hinzu, die Middleware lehnt Anfragen ohne ihn mit 403 ab (`/healthz` ausgenommen).
  Für einen späteren Betrieb mit eigenem Cloudflare; heute leer.
- Weil eine direkt angesprochene App ihre Adresse nicht sicher kennt, haben die schützenden Grenzen
  zusätzlich eine Obergrenze ohne Adresse: höchstens 6 Anmeldelinks pro E-Mail-Adresse und Stunde,
  höchstens 200 unbekannte Kurzlinks pro Workspace und Stunde. Danach lösen nur noch QR-Codes auf
  (71 Bit Zufall); getippte Kurzlinks führen auf den Hinweis „zu viele Versuche“. Ein Angreifer kann so
  höchstens die getippten Kurzlinks für eine Stunde stören, aber keine Exposés finden.
- IPv6-Adressen zählen nach ihrem /64-Netz, weil ein Anschluss meist ein ganzes /64 besitzt.

## ADR-0065 · Entwurfserkennung nur ja/nein, Live-Feed nur „ist gerade da“ (2026-10-21, ändert ADR-0023)

Nach dem Security-Audit (Befund M3) hat der Owner entschieden, die Beobachtung der Besucher
einzubremsen:

- **Entwurfserkennung** erfasst nur noch, ob jemand im Chat angefangen hat zu schreiben (ja/nein,
  Zeitpunkt). Kein Inhalt, keine Länge; die Einstellung `chat.storeDraftContent` ist entfernt. Das
  Widget meldet nur den Wechsel leer ↔ nicht leer. Die Signale `draft_short` und `draft_long` werden zu
  einem Signal `draft` mit Gewicht 0,5 (vorher 0,4 und 0,6), damit „wollte schreiben“ zusammen mit
  Besuch und Lesen weiter die 50-%-Schwelle erreicht. `chat_drafts.length` und `max_length` enthalten
  nur noch 0 oder 1, `content` bleibt leer; die Spalten bleiben, damit die vorige App-Version weiterläuft
  (Migration 0019 bereinigt Altdaten und gespeicherte Signale).
- **Live im Cockpit** steht nur noch, dass ein Kunde gerade im Exposé ist, eine Zeile pro Kunde. Keine
  Abschnitte, keine Klicks, kein „Besucher tippt …“ im Chat. Timeline, Heatmap und Auswertung zeigen die
  Details weiter im Nachhinein. Die Tippanzeige des Owners für den Besucher bleibt (ja/nein).
- Die Datenschutzerklärung-Vorlage zählt alle Messwerte einzeln auf, nennt die Entwurfserkennung als
  ja/nein, die Live-Anzeige „ist gerade da“ und den Session Storage des Chats.

## ADR-0065 · Messung in zwei Stufen: Basis ohne, Lesestatistik und Aufzeichnung mit Einwilligung (2026-10-21, ändert ADR-0042)

Die rechtliche Einschätzung (Projekt-Dokument „Aquisiteur: Datenschutz, Tracking und Einwilligungen“)
kam zu dem Schluss, dass „cookieless“ allein § 25 TDDDG bzw. § 165 Abs. 3 TKG 2021 nicht erfüllt: Ein
Script, das Scrollen, sichtbare Abschnitte, Hover oder Eingaben beobachtet und sendet, greift nach den
EDSA-Leitlinien 2/2023 auf das Endgerät zu. Unbedingt erforderlich ist das für den Besucher nicht. Der
Owner hat die zwei Stufen gewählt:

- **Basis ohne Einwilligung**: Besuchsstart (`page_view`) mit dem, was die angeforderte URL trägt (Slug,
  Ticket), dazu Header (Gerät aus dem User-Agent, Stadt aus `cf-ipcity`), Teilen und Widerspruch, alles
  was der Besucher absendet (Chat, Rückruf). Das Script schickt keine Fenstergröße mehr. Alles, was es
  sonst beobachtet, bleibt im Speicher der Seite für die Nudges.
- **Lesestatistik mit Einwilligung**: alle übrigen Ereignisse des Scripts (`isStatisticsEvent`), das
  Tipp-Signal im Chat und damit Live-Anwesenheit über Heartbeats. Ab dem „Ja“, nie rückwirkend. Der
  Server prüft je Batch die letzte Entscheidung des Besuchs (`consents.scope = 'statistics'`) und
  verwirft sonst; das Script hält die Ereignisse ohnehin zurück. Ein früheres „Ja“ des Geräts schickt das
  Script für den neuen Besuch selbst als Nachweis, bevor es das erste Batch sendet.
- **Aufzeichnung** bleibt eine eigene Einwilligung (`scope = 'replay'`, Standard ohne `scope` für alte
  Clients).
- **Hinweis** (`src/components/expose/consent-notice.tsx`) in jedem öffentlichen Exposé statt nur bei
  eingeschalteter Aufzeichnung: nicht blockierend, sofort nach dem Laden statt nach 8 s (sonst würde
  vorher gemessen). „Ablehnen“, „Einstellungen“, „Akzeptieren“ gleichwertig; „Akzeptieren“ meint nur die
  Lesestatistik. Unter „Einstellungen“ beide Schalter aus. Schließen ist keine Antwort. Global Privacy
  Control (`Sec-GPC: 1`) und das Owner-Gerät: kein Hinweis, keine Lesestatistik. Im Browser
  `aq-consent` mit Version, Tag und den zwei Entscheidungen, nach 180 Tagen oder neuer Textversion neu
  fragen. „Datenschutz-Einstellungen“ im Fuß öffnet die Schalter.
- **Widerruf** der Lesestatistik löscht deren Ereignisse dieses Besuchs, setzt aktive Zeit und
  Scrolltiefe zurück und entfernt das Tipp-Signal; Basis und Nachweise bleiben.
- **Brief** bekommt einen Datenschutzhinweis nach Art. 14 DSGVO (Herkunft der Adresse aus
  `legal.dataSource`, persönlicher Link, Widerspruch, Link auf `/datenschutz`).
- **Fristen**: Standard 180 statt 365 Tage für Ereignisse und 30 statt 90 Tage für Aufzeichnungen.
  Gespeicherte Werte bestehender Workspaces bleiben, wie sie sind.
- **Tonfall**: Hinweis, Briefhinweis und Datenschutzerklärung sachlich in der Wir-Form mit Angabe der
  Rechtsgrundlagen, nicht persönlich-umgangssprachlich (Wunsch des Inhabers).
- **Worker-Größe**: Hinweis und Kontakt-Layer lädt nur ein Effekt im Browser; `next.config.ts` lässt
  beide aus dem Server-Bundle weg (wie die PDF-Dokumente), sonst risse der Worker die 2.900 KiB.

Folge: Wer ablehnt, liefert dem Score nur Besuch, Wiederkehr, Chat, Rückruf und Teilen. Offen für
später: Klicks auf Kontaktwege über eine Server-Weiterleitung messen (dann Basis), automatisches Löschen
von Kunden ohne Reaktion nach 12 Monaten.

## ADR-0066 · Bot- und Missbrauchsschutz für Chat und Rückruf (2026-10-21, baut auf dem Security-Audit auf)

Der Owner wollte für den Chat etablierte Absicherungen gegen Bots und Missbrauch. Bis dahin gab es ein
Rate Limit pro Besuch (30 Nachrichten in 10 Minuten), die Längengrenze und ein Honeypot nur im
Rückrufformular; Befund M2 des Audits (Flut pro Exposé) war offen. Entschieden, in Schichten, die
zusammen wirken und einzeln nicht perfekt sein müssen:

- **Proof of Work statt CAPTCHA.** Vor der ersten Nachricht einer Unterhaltung und vor jedem
  Rückrufwunsch löst der Browser unsichtbar eine kleine Rechenaufgabe nach dem ALTCHA-Prinzip: Der Server
  signiert (HMAC, 15 Minuten) den SHA-256 aus Salz und einer geheimen Zahl unter 50.000, der Browser
  probiert Zahlen, bis der Hash passt (im Mittel 25.000 Hashes, auf dem Laptop rund eine halbe Sekunde,
  beginnt beim Öffnen von Chat bzw. Formular). Gebunden an den Besuch (Chat) bzw. an das Exposé (Rückruf
  ohne Besuchs-Token). Selbst gebaut mit WebCrypto, ohne Abhängigkeit, ohne Cookie, ohne gespeicherten
  Zustand. Verworfen: **Cloudflare Turnstile**, **reCAPTCHA**, **hCaptcha**: übermitteln IP und
  Gerätesignale an Dritte (teils USA), bräuchten nach § 25 TDDDG eine Einwilligung oder zumindest eine
  zusätzliche Abwägung und Auftragsverarbeitung, und der heutige Betrieb hat kein eigenes Cloudflare.
  **Friendly Captcha** (EU) wäre möglich, kostet aber Geld und bringt einen weiteren Dienstleister; das
  Prinzip ist dasselbe. Der Proof of Work hält keinen entschlossenen Angreifer auf, macht aber Massen
  teuer; die Grenzen darunter decken den Rest.
- **Honeypot** jetzt auch im Chat (Feld `website`, für Menschen und Screenreader unsichtbar).
- **Rate Limits in Ebenen** (`CHAT_LIMITS`): pro Besuch 8 pro Minute und 30 pro 10 Minuten, pro
  Client-Netz 60 pro 10 Minuten (Hash aus Secret und IP, IPv6 als /64, wie ADR-0064), pro Exposé 120
  Nachrichten und 10 neue Unterhaltungen pro Stunde, pro Workspace 1.500 pro Stunde (schützt das Handy des
  Owners vor einer Push-Flut). Rückruf: 5 pro Client, 10 pro Exposé, 100 pro Workspace und Stunde. Exposé
  und Workspace zählen ohne Adresse, halten also auch, wenn ein Client seine Adresse wechselt. Gezählt
  wird von eng nach weit und beim ersten vollen Zähler abgebrochen; sonst könnte ein einzelner Client,
  den seine eigene Grenze längst abweist, die geteilten Zähler füllen und Chat oder Rückruf für alle
  sperren. Eine gelöste Rückruf-Aufgabe gilt nur einmal (Marker in `rate_limits`), weil sie an das
  Exposé statt an einen Besuch gebunden ist.
- **Inhaltsregeln** (`src/domain/chat-guard.ts`): Unicode NFC, unsichtbare Zeichen und
  Bidi-Steuerzeichen entfernt (sonst kann eine Nachricht im Cockpit anders aussehen, als sie ist), höchstens
  drei Links und 40 Zeilen, dieselbe Nachricht innerhalb von zwei Minuten abgelehnt. Kein Wortfilter:
  Interessenten schreiben frei, und ein falsch abgelehnter Kunde kostet mehr als eine Spam-Nachricht.
- **Sperren durch den Owner**: „Chat sperren“ auf der Chat-Seite setzt `prospects.chat_blocked_at`. Das
  Exposé nimmt dann keine Nachrichten, Rückkanäle, Rückrufe und Rechenaufgaben (`/t/challenge`) mehr an und zeigt
  einen sachlichen Hinweis auf andere Kontaktwege. Pro Kunde statt pro IP, weil jeder Kunde sein eigenes
  Exposé hat und so keine Adresse gespeichert werden muss. Aufhebbar, im Audit-Log.
- Antworten der Routen: 403 gesperrt, 422 Inhaltsregel (mit Grund), 428 Aufgabe fehlt oder abgelaufen
  (das Widget löst dann einmal neu), 429 Grenze erreicht.

Folge: Die Datenschutzerklärung-Vorlage nennt die Rechenaufgabe und den Hash der IP auch für Chat und
Rückruf. Offen für später: Besuchsstarts pro Client begrenzen (Rest von M2), bei echtem Spam-Aufkommen
eine Quarantäne statt Ablehnung.

## ADR-0067 · Projekte, Angebote und Online-Annahme (2026-10-22, Phase 7a)

Kontext: Der Owner will Angebote, die das Exposé mit Preisen füllen, in Tranchen zahlbar sind und
Wartungsverträge abbilden; später Rechnungen nach österreichischem Recht (ZIELPROMPT §7.10).
Entschieden für Phase 7a:

- **Kunde → Projekt → Exposé und Angebot.** Neue Tabelle `projects`; `exposes.project_id` ist nullable,
  die Migration `0022` legt für jeden Kunden mit Exposé ein Projekt „Erstakquise“ an, und das
  Veröffentlichen ordnet neue Exposés dem ältesten Projekt des Kunden zu. Mehrere Exposés pro Kunde
  bleiben für später: `exposes_workspace_prospect_idx` ist eindeutig und viele Stellen setzen ein
  Exposé pro Kunde voraus.
- **Entwurf als JSONB, jede Sendung als unveränderliche Version.** `offers.draft` hält das Dokument
  (Zod-Schema `src/domain/offers/schema.ts`), „Angebot fertigstellen“ friert es in `offer_versions` ein:
  mit Steuermodus und Steuerhinweis zum Zeitpunkt der Sendung, Gültigkeit und SHA-256 über das
  kanonische JSON. Der öffentliche Link `/a/<token>` (22 Zeichen base62) bleibt über alle Versionen
  gleich und zeigt die neueste. Eine Annahme gilt nur für die Version, die der Kunde gesehen hat
  (sonst 409, neu laden). Verworfen: Positionen als eigene Tabellen; das Angebot ist ein Dokument, das
  als Ganzes versioniert und später in die Rechnung kopiert wird.
- **Nummernkreis** `AN-JJJJ-NNNN` pro Workspace und Jahr in `number_series` (Upsert mit Zähler, in der
  Transaktion der Sendung, also lückenlos für versendete Angebote). Dieselbe Tabelle trägt in 7b die
  Rechnungsnummern.
- **Geld in ganzen Cent**, jede Zeile kaufmännisch gerundet, USt je Satz auf die Summe der Zeilen
  (20/13/10/0 %). Getrennte Summen für einmalig und je Intervall (monatlich bis jährlich). Der
  Gesamtrabatt gilt nur für die einmaligen Positionen und mindert jede USt-Basis anteilig; im Exposé
  steckt er in den einmaligen Preisen. Tranchen in Prozent oder Festbetrag, die letzte nimmt den Rest;
  Tranchen davor werden auf den verbleibenden Betrag gekappt, damit keine negativ wird, wenn der Kunde
  Optionen abwählt, und ein schon in der Standardauswahl überbuchter Plan lässt sich nicht senden.
- **Kleinunternehmer als Standard** (`workspace_settings.billing`): keine USt, Hinweis nach § 6 Abs. 1
  Z 27 UStG 1994, umschaltbar auf Regelbesteuerung. Keine Steuerberatung; der Spec-Abschnitt nennt die
  Grenzen.
- **Online-Annahme als einfache elektronische Erklärung**: Name, optional Funktion, Pflicht-Häkchen mit
  den gewählten Beträgen im Text. Gespeichert werden Zeitpunkt, Version, Prüfsumme, gewählte Variante,
  Optionen und Summen, **keine IP-Adresse** (passt zu ADR-0064; für Werkverträge dieser Größe reicht die
  formfreie Annahme). Die Version wird in der sperrenden Transaktion noch einmal geprüft, sodass eine
  inzwischen ersetzte Fassung nicht angenommen werden kann. Rate Limit 10 pro Stunde und Angebot, Honeypot wie ADR-0066. Annahme setzt den
  Kunden auf „Gewonnen“ (außer vom eigenen Gerät) und das Projekt auf „Beauftragt“.
- **Benachrichtigungen ohne Regel-Backfill**: Die neuen Trigger `offer_viewed` und `offer_answered`
  gehen über Fallback-Kanäle (`OFFER_FALLBACK`), bis der Owner eigene Regeln anlegt. Ein Backfill wie in
  `0015` scheitert, weil ein neuer Enum-Wert nicht in derselben Migrations-Transaktion benutzt werden darf.
- **Exposé-Anbindung**: Ein Preisblock mit `"source": "offer"` wird beim Veröffentlichen aus dem
  angenommenen, sonst dem zuletzt geänderten versendeten Angebot des Projekts gefüllt (in der versendeten
  Fassung; Entwürfe werden nie von selbst öffentlich); „Ins Exposé übernehmen“ erzeugt
  eine neue Exposé-Version mit diesen Preisen. Laufende Beträge in längeren Intervallen erscheinen im
  Exposé als Monatswert mit Hinweis auf die Abrechnung.
- **Worker-Größe**: Der Angebots-Editor ist eine reine Client-Komponente, wird nach dem Mounten geladen
  (`offer-editor-lazy.tsx`, Skeleton solange) und in `next.config.ts` aus dem Server-Bundle aliasiert
  (wie ADR-0035). `radix-ui` wird nur über Unterpfade (`radix-ui/slot`, `/label`, `/dialog`) importiert,
  der Barrel-Import zog alle Primitives in den Worker. Zusammen 2864 statt 2982 KiB (Limit 2900).
  `server-only` fehlt bewusst in `src/server/projects.ts` und `src/server/offers/pricing.ts`, weil
  `scripts/seed.ts` sie über `publish.ts` importiert.
- Die Angebotsseite läuft wie das Exposé über die System-Verbindung, auf den Workspace des Hosts
  beschränkt (ADR-0012), ohne `Intl` und ohne Cockpit-Code (ADR-0048). Ansichten von Bots und vom
  eigenen Gerät zählen nicht.

Offen für 7b/7c: das Rechnungsprofil am Kunden (Rechnungsadresse, Land, UID, Rechnungs-E-Mail,
Zahlungsziel), erst mit den Rechnungen nötig; Rechnungen aus angenommenen Angeboten und Tranchen, PDF, Versand per Resend mit
Freigabe über die Aufgabenliste, Wartungsläufe, Mahnwesen; `offer.json` im Exposé-Ordner, Angebotsanfrage
aus dem Exposé. Das Löschen eines Kunden löscht seine Angebote mit; ab 7b muss es bei Rechnungen
verweigert werden.

## ADR-0068 · Worker-Größe nur noch als Warnung (2026-10-22)

Betrieben wird mit Docker Compose auf Mikrus (ADR-0054); Cloudflare ist nur ein baubarer Rückfall. Die
harte CI-Grenze von 2900 KiB (Free-Plan, ADR-0035) hat bei Phase 7a mehr Zeit gekostet als sie nützt. Auf
Wunsch des Owners warnt der CI-Job „Cloudflare bundle“ über 2900 KiB nur noch und schlägt erst über
9800 KiB fehl (Workers Paid erlaubt 10 MB). Der Build selbst muss weiter durchlaufen. Wer über 2900 KiB
geht, kann auf Cloudflare nur noch im bezahlten Plan (rund 5 $ im Monat) deployen. Die Lazy-Loading-Regeln
aus ADR-0035/0037 gelten weiter, weil sie auch die Ladezeit im Cockpit verbessern.

## ADR-0069 · Reiter auf der Kundenseite, kompakter Angebots-Editor (2026-10-22)

Die Kundenseite war eine lange Spalte. Sie hat jetzt Reiter (Übersicht, Besuche, Briefe und Links,
Stammdaten; die Übersicht einspaltig: Kontaktabsicht, Aufgaben, Chat, Projekte, Timeline) über `HashTabs` (`src/components/ui/tabs.tsx`): alle Panels werden auf dem Server gerendert
und nur ausgeblendet, der URL-Hash wählt den Reiter. Ein Hash, der auf ein Element in einem Panel zeigt
(`#datenschutz`, `#chat`, `aufgabe-…`), öffnet dessen Reiter, sodass Links aus Benachrichtigungen
unverändert funktionieren. Im Angebots-Editor stehen Positionen in zwei Zeilen (Leistung, dann Menge,
Einheit, Preis, Abrechnung und Zeilensumme); Beschreibung, Rabatt, USt-Satz, Optional und Varianten
liegen unter „Weitere Angaben“, offen, sobald etwas davon gesetzt ist. Die Varianten-Karte erscheint erst,
wenn Varianten angeboten werden. Speichern und Fertigstellen stehen ab `xl` oben in der Seitenleiste,
darunter in der schwebenden Leiste mit der Summe.

## ADR-0070 · Rechnungen nach österreichischem Recht (2026-10-22)

Phase 7b (ZIELPROMPT §7.10). Die Steuerregeln sind recherchiert, keine Steuerberatung; vor der ersten
echten Rechnung mit dem Steuerberater abgleichen.

- **Datenmodell**: `invoices` (Art: Rechnung, Anzahlung, Schluss, Storno; Status: Entwurf, ausgestellt,
  storniert) und `invoice_payments`, beide mandantengetrennt mit RLS. Das Rechnungsprofil liegt als
  `prospects.billing` (jsonb) am Kunden: Kundenart, Name, abweichende Adresse, Land, UID, E-Mail,
  Zahlungsziel. Bank, Zahlungsziel und Texte stehen in `workspace_settings.billing`.
- **Unveränderlich in der Datenbank**: Beim Ausstellen werden Nummer (`RE-YYYY-NNNN` aus
  `number_series`, in derselben Transaktion), Datum, Fälligkeit, Dokument, Summen, Absender und Empfänger
  eingefroren und eine SHA-256-Prüfsumme gespeichert. Der Trigger `app.invoices_immutable` lässt danach
  nur den Wechsel „ausgestellt → storniert“ zu und verweigert das Löschen, außer der ganze Workspace wird
  gelöscht. Die Fremdschlüssel auf Kunde, Projekt und Angebot sind NO ACTION: Ein Kunde oder Projekt mit
  ausgestellter Rechnung bleibt sieben Jahre (§ 132 BAO); Entwürfe gehen mit.
- **Storno** erzeugt sofort eine ausgestellte Stornorechnung mit eigener Nummer, Verweis und negativen
  Beträgen (gleiche Positionen, Vorzeichen in `invoiceTotals`). Danach kann die Tranche neu abgerechnet
  werden.
- **Tranchen**: „Rechnungen aus Tranchen erstellen“ am angenommenen Angebot legt je offene Tranche einen
  Entwurf an, aus der angenommenen Fassung und Auswahl. Anzahlungen tragen eine Zeile je Steuersatz im
  Verhältnis der Bemessungsgrundlagen; die letzte Tranche wird zur Schlussrechnung mit allen Positionen
  und zieht die ausgestellten, nicht stornierten Anzahlungen je Steuersatz ab (beim Laden des Entwurfs
  neu berechnet, beim Ausstellen eingefroren). Ein Plan mit nur einer Tranche ergibt eine normale Rechnung.
  Damit nichts doppelt abgerechnet wird: Die Schlussrechnung lässt sich erst ausstellen, wenn keine
  Anzahlung des Angebots mehr Entwurf ist, und eine Anzahlung, die eine ausgestellte Schlussrechnung
  abzieht, lässt sich erst nach dem Storno der Schlussrechnung stornieren.
- **Steuer**: Behandlung je Rechnung, vorbelegt aus Steuermodus, Land, Kundenart und UID:
  Kleinunternehmer, österreichische USt, Reverse Charge (EU-Unternehmen mit UID), nicht steuerbar
  (Unternehmen im Drittland). Privatkunden im Ausland und EU-Unternehmen ohne UID werden als Rückfrage
  markiert. Vor dem Ausstellen prüft `issueIssues` die Pflichtangaben nach § 11 UStG je Betrag (400 € und
  10.000 € brutto; die eigene UID verlangt sie außer bei Kleinunternehmern). Der Grenzwächter summiert,
  was mit Kleinunternehmer-Rechnungen im Jahr abgerechnet wurde (Schlussrechnungen ohne die schon
  gezählten Anzahlungen, Stornos negativ), und warnt ab 80 % von 55.000 €. Eine Kleinunternehmer-Rechnung,
  mit der die Toleranz von 60.500 € überschritten würde, lässt sich nicht mehr ausstellen, weil sie schon
  Umsatzsteuer ausweisen muss. Privatkunden im Ausland bekommen bis zur Klärung mit dem Steuerberater
  die Behandlung wie im Inland und eine Rückfrage, noch keinen eigenen Hinweistext.
- **PDF** wie beim Angebot mit react-pdf im Browser (ADR-0035), mit EPC-QR-Code, sobald eine IBAN
  hinterlegt ist; Editor und PDF-Dokument sind aus dem Server-Bundle aliasiert. **CSV** pro Monat mit
  Semikolon, Dezimalkomma und BOM, Formeln entschärft.
- Ausgestellt, storniert und bezahlt stehen in der Timeline des Kunden; Rechnungen und Zahlungen sind
  im Daten- und Kundenexport.

Verschoben nach 7c: eingebettetes ZUGFeRD/Factur-X, ZIP mit PDFs, VIES-Prüfung und Vormerkung für die
Zusammenfassende Meldung, Sperrvermerk bei einer Datenschutz-Löschung (bis dahin wird das Löschen eines
Kunden mit ausgestellter Rechnung verweigert und die Seite erklärt warum), Versand per E-Mail.

## ADR-0071 · Rechnungen: CI, E-Rechnung, ZIP, VIES und Sperrvermerk (2026-10-22, Phase 7c-1)

- **CI im PDF**: Rechnungen zeigen das Logo aus den Briefeinstellungen (sonst den Namen in der
  Akzentfarbe) und die Akzentfarbe an Titel, Tabellenkopf, Gesamtbetrag und Zahlungsbox.
  `printableInvoice` lädt beides serverseitig; für die Schrift auf Weiß wird die Akzentfarbe mit
  `readableOn` abgedunkelt, damit der Kontrast reicht.
- **Factur-X / ZUGFeRD 2 (Profil EN 16931)**: Ausgestellte Rechnungen sind PDF/A-3b mit eingebetteter
  `factur-x.xml` (CII, AFRelationship Alternative, sRGB-OutputIntent, XMP mit Factur-X-Erweiterung).
  Das XML baut `facturXml` rein in `src/domain/invoices/cii.ts`, pdf-lib bettet es im Browser ein
  (aliasiert wie react-pdf). Typcodes 380/386/381, Kategorien S, E, AE, O; Stornos mit positiven
  Beträgen und Verweis auf die Originalrechnung. Ohne UID kennzeichnet die neue **Steuernummer** den
  Verkäufer (BR-CO-26). Mit dem Mustang-Validator geprüft (PDF/A-3b konform, XML gültig).
- **ZIP für den Steuerberater**: pro Monat CSV plus alle ausgestellten Rechnungen als PDF, im Browser
  gerendert und mit fflate gepackt (ohne Kompression, PDFs sind schon komprimiert), höchstens 200.
- **VIES**: neuer Port `VatCheckPort` (`vies`, `fake`, `none`; `VAT_CHECK_PROVIDER`, Standard `vies`).
  Beim Speichern eines Rechnungsprofils mit UID wird geprüft; Ergebnis und Abfragenummer stehen im
  Profil. Reverse Charge mit laut VIES ungültiger UID lässt sich nicht ausstellen, ohne Bestätigung gibt
  es eine Warnung. VIES nicht erreichbar blockiert nichts.
- **Zusammenfassende Meldung**: CSV je Quartal mit den Reverse-Charge-Bemessungsgrundlagen je Kunden-UID
  (Stornos negativ, Schlussrechnungen ohne die schon gemeldeten Anzahlungen). Ist VIES beim Speichern
  nicht erreichbar, bleibt die letzte Prüfung derselben UID stehen. Der Link erscheint nur, wenn es Reverse-Charge-Rechnungen gibt.
- **Sperrvermerk statt Löschung**: Ein Löschwunsch für einen Kunden mit ausgestellten Rechnungen löscht
  alles außer Firmenname, Projekten, Angeboten und ausgestellten Rechnungen (Exposé mit Links, Besuchen,
  Chats und Rückrufen, Briefe, Aufzeichnungen, Aufgaben, Ansprechpartner, Kontaktdaten, Rechnungsprofil,
  Rechnungsentwürfe) und sperrt Briefe, Chat und neue Rechnungen (`restricted_at`). Die Retention im
  stündlichen Job löscht den Rest, sobald die jüngste ausgestellte Rechnung älter als sieben Jahre ab
  Jahresende ist (§ 132 BAO). Der Trigger `app.invoices_immutable` erlaubt das Löschen erst ab dann.
  Für die Löschung im Mandanten-Kontext bekommt `aquisiteur_app` DELETE auf `intent_scores` und
  `notifications`; Besuche, Events und Chats gehen über die Kaskade des Exposés. Öffentliche
  Angebotsseiten des Kunden sind danach nicht mehr erreichbar. Danach
  lassen sich Stammdaten, Ansprechpartner und Rechnungsprofil nicht mehr ändern, der Sperrvermerk nicht
  aufheben und kein neues Exposé für den Schlüssel veröffentlichen (409).

## ADR-0072 · Rechnungsversand per E-Mail (2026-10-22, Phase 7c-2)

- **Versand aus der Rechnung**: Ausgestellte Rechnungen haben eine Karte „Versand“ mit Empfänger
  (Rechnungs-E-Mail des Profils, sonst die des Kunden oder des Hauptansprechpartners), Betreff und Text
  aus den Einstellungen mit Platzhaltern (`{art}`, `{nummer}`, `{betrag}`, `{faellig}`, `{link}`,
  `{absender}`, `{kunde}`). Das PDF entsteht wie beim Download im Browser (ADR-0037) und wird mit der
  ersten Mail unter `<workspace>/invoices/<id>.pdf` gespeichert; jede spätere Mail und die Rechnungsseite
  geben genau diese Datei heraus, auch wenn der Browser etwas anderes schickt.
- **Absender und Antworten**: Die Mail kommt von der Plattform-Adresse aus `EMAIL_FROM` (eigene
  Versand-Subdomain) mit dem Namen der Agentur; `Reply-To` liefert `replyToAddress` an einer Stelle
  (Kontakt-E-Mail des Workspaces, sonst die des Owners). Jede Mail bekommt eine eigene `Message-ID`
  und eine Zeile in `outbound_emails` (Kunde, Projekt, Rechnung, Empfänger, Betreff, Status), damit ein
  späterer Posteingang Antworten zuordnen kann. Der Text selbst wird nicht gespeichert.
- **Ablauf**: Die Zeile wird mit Status „sending“ angelegt und festgeschrieben, die Mail außerhalb der
  Transaktion gesendet, danach „sent“ oder „failed“ mit Grund. Erst nach der Annahme durch den Anbieter
  erledigen sich offene Freigabe-Aufgaben der Rechnung, und „Rechnung … per E-Mail gesendet“ steht in
  der Timeline.
- **Zustellstatus**: `POST /api/webhooks/resend`, Svix-Signatur mit `RESEND_WEBHOOK_SECRET`, höchstens fünf
  Minuten alt. Der Status geht nur vorwärts (`nextEmailStatus`), doppelte und verspätete Ereignisse
  ändern nichts; unzustellbar, Spam-Meldung und Fehler sind endgültig und legen einmal eine Aufgabe
  „Adresse prüfen“ an. Ein Ereignis zu einer noch unbekannten Anbieter-ID wird mit 503 abgelehnt,
  solange eine frische Mail (unter zehn Minuten) noch auf ihre ID wartet, damit Resend es erneut
  zustellt; sonst gehört es zu einer anderen Mail (Anmeldelink, Zusammenfassung) und wird verworfen.
  Empfängeradressen stehen nur in `outbound_emails`, nicht im Audit-Log.
  Unbekannte Ereignisse (später eingehende Mails) werden ignoriert. Keine Öffnungs-Pixel; die
  Rechnungsseite merkt sich nur den ersten echten Aufruf (ohne Bots und Owner-Geräte).
- **Rechnungsseite** `/r/<token>` (22 Zeichen base62, `noindex`, kein Referrer): Betrag, Stand der Zahlung,
  Bankverbindung und das gespeicherte PDF. Token und PDF stehen in `invoice_shares`, weil die Zeile in
  `invoices` ab dem Ausstellen eingefroren ist. Kunden mit Sperrvermerk haben keine Rechnungsseite; die
  Mails des Kunden werden beim Sperrvermerk gelöscht, die Rechnung bleibt.
- **Freigabe**: Versandmodus pro Workspace (manuell, Freigabe über eine Aufgabe als Standard,
  automatisch). `requestInvoiceApproval` legt die Aufgabe „Rechnung … freigeben“ mit Verweis auf die
  Rechnung an; der stündliche Job nutzt sie ab 7c-3 für Wartungs- und Mahnentwürfe. Die automatische
  Stufe braucht ein serverseitig erzeugtes PDF und kommt mit 7c-3; bis dahin ist sie in den
  Einstellungen nicht wählbar.
- Ohne `EMAIL_PROVIDER=resend` landen Rechnungsmails im Log, wie Anmeldelinks.

## ADR-0073 · Wartungsverträge mit stündlicher Abrechnung und Server-PDF (2026-10-23)

Phase 7c-3 (ZIELPROMPT §7.10). Die wiederkehrenden Positionen eines angenommenen Angebots werden zu
Wartungsverträgen, die der stündliche Job abrechnet.

- **Vertrag** (`maintenance_contracts`): einer pro Intervall der angenommenen Auswahl („Wartungsvertrag
  anlegen“ im Angebot, ein zweiter Klick legt nichts doppelt an). Er übernimmt Positionen (Preis pro
  vollem Zeitraum, Gesamtrabatt gilt wie im Angebot nur für Einmaliges), Abrechnung im Voraus oder
  nachträglich, Mindestlaufzeit und Kündigungsfrist. Der Beginn folgt dem Angebot: Annahmetag, festes
  Datum oder offen bis zum Go-live; dann trägt der Owner ihn im Vertrag ein. Nach der ersten Rechnung
  steht er fest.
- **Zeiträume** (`src/domain/invoices/maintenance.ts`, rein): Kalendermonat, -quartal, -halbjahr, -jahr.
  Erster und letzter Zeitraum sind tagesgenau anteilig (Preis × Tage / Tage des Zeitraums, Hinweis in
  der Position). Im Voraus wird am ersten Tag des Zeitraums abgerechnet, nachträglich am Tag danach.
  Höchstens zwölf Zeiträume pro Vertrag und Lauf holen eine Lücke auf.
- **Fortschritt** über `billed_until` am Vertrag, nicht über vorhandene Rechnungen: Löscht der Owner
  einen Entwurf, entsteht er nicht neu (wie bei den Folgebriefen, ADR-0062). Ein eindeutiger Index
  `(contract_id, contract_period_from)` ohne Stornos verhindert doppelte Rechnungen, die Zeile des
  Vertrags wird pro Zeitraum gesperrt.
- **Kündigung**: frühestes Ende ist das Monatsende nach Ablauf der Kündigungsfrist, nicht vor Ende der
  Mindestlaufzeit; ein späteres Ende ist wählbar, eines vor dem schon Abgerechneten nicht. Die
  Kündigung lässt sich zurücknehmen.
- **Versand**: Modus pro Vertrag, sonst der des Workspaces (Standard: Freigabe). Manuell legt nur den
  Entwurf an, Freigabe zusätzlich die Aufgabe „Rechnung … freigeben“. Automatisch geht eine Rechnung
  nur hinaus, wenn der Zeitraum voll ist und die Positionen genau denen der letzten ausgestellten
  Rechnung des Vertrags gleichen; die erste Rechnung, ein anteiliger Zeitraum oder ein geänderter
  Preis brauchen also immer einen Blick. Dann stellt der Job die Rechnung aus, erzeugt das PDF und
  sendet es wie in ADR-0072. Jeder Fehler auf dem Weg (unvollständig, keine Adresse, PDF, Versand)
  fällt auf die Freigabe-Aufgabe zurück, mit dem Grund vorne in der Notiz.
- **PDF auf dem Server** (Entscheidung des Owners): Auf dem Node-Profil rendert react-pdf dieselbe
  `InvoicePages`-Komponente wie im Browser, inklusive Factur-X (`invoicePdfBytes`); Schriften kommen
  dort von der Platte. Das Worker-Bundle (`pnpm cf:build` setzt `HOSTING_PROFILE=cloudflare` beim
  Build) hält den Renderer weiter per Alias draußen (ADR-0035, ADR-0037); dort fällt „automatisch“ auf
  die Freigabe zurück. react-pdf liest kein WebP und der Server hat keine Bildbibliothek, daher lädt
  der Browser beim Logo zusätzlich ein PNG der größten Breite hoch. Ein vorher hochgeladenes Logo ohne
  PNG führt zur Freigabe mit dem Hinweis, das Logo neu hochzuladen, statt stillschweigend ohne Logo
  zu drucken.
- Der Job schreibt als erster Owner des Workspaces in `withTenant` (`workspaceOwner`), Kunden mit
  Sperrvermerk werden übersprungen.
- VPI-Indexierung und Stundenkontingent folgen als eigener Schritt 7c-3b (Entscheidung des Owners);
  bis dahin lassen sich Preise nur über einen neuen Vertrag ändern.

## ADR-0074 · Mahnwesen: Zahlungserinnerung und zwei Mahnungen mit Freigabe (2026-10-23)

Phase 7c-4 (ZIELPROMPT §7.10). Überfällige Rechnungen bekommen eine Zahlungserinnerung und danach zwei
Mahnungen, vom stündlichen Job vorbereitet und mit derselben Freigabe-Logik wie Rechnungen versendet.

- **Stufen** (`src/domain/invoices/dunning.ts`, rein): Zahlungserinnerung, 1. Mahnung, Letzte Mahnung,
  standardmäßig 3, 14 und 28 Tage nach Fälligkeit (in den Einstellungen änderbar, aufsteigend). Jede
  Mahnung nennt eine Zahlungsfrist (Standard 7 Tage); die nächste Stufe kommt frühestens am Tag nach
  dieser Frist, auch wenn der Plan früher wäre. Stufen werden nie übersprungen: Eine Rechnung, die
  schon 30 Tage offen ist, bekommt zuerst die Erinnerung.
- **Zinsen und Pauschale** sind optional und gelten nur gegenüber Unternehmen (Kundentyp im
  Rechnungsprofil) und erst ab der 1. Mahnung; die Erinnerung bleibt kostenlos. Verzugszinsen nach
  § 456 UGB: Basiszinssatz plus 9,2 Prozentpunkte, tageweise vom Tag nach der Fälligkeit bis zum
  Versandtag auf den offenen Betrag, Satz auf 365 Tage. Den Basiszinssatz trägt der Owner ein
  (Standard 1,53 %, Stand 2. Halbjahr 2026), weil er sich halbjährlich ändert. Die 40 € nach § 458 UGB
  kommen einmal pro Forderung dazu, nicht pro Mahnung. Zinsen und Pauschale stehen nur in der Mahnung,
  nicht als neue Rechnung; Zahlungen werden weiter gegen den Rechnungsbetrag erfasst. Verbraucher
  bekommen keine Zinsen (§ 1333 ABGB bliebe möglich, ist aber nicht umgesetzt).
- **Datenmodell**: `invoice_reminders` mit einer Zeile pro Rechnung und Stufe (eindeutig), Status
  Entwurf oder versendet. Offener Betrag, Zinsen, Satz, Pauschale und Frist werden beim Anlegen
  berechnet und beim Senden für den Versandtag neu berechnet und festgeschrieben. Rechnungen selbst
  bleiben unverändert (ADR-0070). `tasks.reminder_id` und `outbound_emails.reminder_id` verbinden
  Aufgabe und Mail mit der Stufe, damit sich die Freigabe der Rechnung und die der Mahnung nicht
  gegenseitig erledigen; die Mail hat die Art `reminder`.
- **Ablauf**: Der Job (Systemverbindung zum Finden, `withTenant` als Owner zum Schreiben) sucht
  ausgestellte, nicht ganz bezahlte Rechnungen ohne wartenden Entwurf, ohne laufende Frist und ohne
  letzte Mahnung, und legt die fällige Stufe an. Modus pro Workspace: aus (der Job legt nichts an),
  manuell (Entwurf an der Rechnung), Freigabe (Standard, zusätzlich die Aufgabe „Zahlungserinnerung zur
  Rechnung … freigeben“) oder automatisch (sofort senden, bei jedem Hindernis Rückfall auf die Aufgabe
  mit Grund). Im Cockpit lässt sich die nächste Stufe auch früher von Hand vorbereiten. Ein verworfener
  Entwurf (etwa nach einer Zahlungszusage) pausiert die Stufe für eine Zahlungsfrist, sonst legte der
  Job sie in der nächsten Stunde wieder an oder sendete sie im Automatikmodus gleich. Die Abfrage des
  Jobs filtert Modus „aus“ und den Tag der nächsten Stufe schon in SQL, damit wartende Rechnungen die
  500 Plätze eines Laufs nicht dauerhaft belegen; mit Freigabe entstehen Entwurf und Aufgabe in einer
  Transaktion.
- **Versand**: E-Mail mit dem gespeicherten PDF der Rechnung im Anhang und dem Link zur Rechnungsseite,
  an die Adresse, an die die Rechnung zuletzt ging. Wurde die Rechnung nie gemailt, rendert der Browser
  das PDF beim ersten Senden (ADR-0072), im Automatikmodus der Server (nur Node-Profil, ADR-0073). Eine
  eigene PDF-Mahnung gibt es nicht; die Texte je Stufe sind fest hinterlegt und vor dem Senden
  editierbar; das Formular kommt mit ausgefüllten Beträgen und Frist. Weil der Text sie festhält,
  schickt das Formular einen Fingerabdruck der Forderung mit: Hat sich seither etwas geändert (eine
  Zahlung, ein neuer Tag), lehnt der Versand ab und die Seite zeigt den neuen Text. Eine zweite Mail
  derselben Stufe ist gesperrt, solange eine frühere nicht gescheitert ist.
- **Aufräumen**: Eine Zahlung, die die Rechnung ganz begleicht, und ein Storno legen wartende
  Entwürfe beiseite (Status `skipped`) und erledigen ihre Aufgabe; gelöscht wird keine Stufe, damit
  das Versand-Log einer Mail erhalten bleibt. Beim Senden wird erneut geprüft. Kunden mit Sperrvermerk bekommen keine
  Mahnungen; ihre versendeten Stufen bleiben als Beleg ohne Personendaten.

## ADR-0075 · Wertsicherung nach VPI und Stundenkontingent im Wartungsvertrag (2026-10-23)

Phase 7c-3b (ZIELPROMPT §7.10). Wartungsverträge können ihre Preise einmal jährlich an den
Verbraucherpreisindex binden und ein Stundenkontingent je Zeitraum enthalten, mit Mehrstunden zum
Stundensatz.

- **Indexwerte trägt der Owner ein**: Statistik Austria bietet keine stabile, kostenlose API für den
  VPI 2020; die Werte erscheinen monatlich und ändern sich danach nicht mehr. Der Vertrag speichert die
  Basis (Monat und Wert in Zehnteln, 128,7 → 1287), den Monat der jährlichen Anpassung (Standard Jänner)
  und einen Schwellenwert in ganzen Prozent (Standard 0). Die Rechenlogik ist rein
  (`src/domain/invoices/indexation.ts`).
- **Zyklus**: Die erste Anpassung frühestens zwölf Monate nach Beginn am Ersten des Anpassungsmonats,
  danach einmal im Jahr im selben Monat, auch wenn eine Ankündigung spät kam. Wirksam wird sie mit dem
  ersten Zeitraum, der nach der Ankündigungsfrist beginnt (Einstellung, Standard 30 Tage) und noch
  nicht abgerechnet ist; ein Zeitraum hat nie zwei Preise.
- **Zweiseitig**: Die Klausel wirkt nach oben und unten, wie es § 6 Abs. 1 Z 5 KSchG für Verbraucher
  verlangt; ein sinkender Index senkt den Preis. Liegt die Änderung unter dem Schwellenwert, wird der
  Zyklus als „keine Anpassung“ festgehalten, die Basis bleibt und Änderungen summieren sich.
- **Ankündigung**: Der Owner trägt Monat und Wert ein, die Seite zeigt Änderung, neue Preise und Stichtag.
  Die Mail (Art `contract_notice`, ohne Anhang, Text editierbar mit Platzhaltern) geht an die
  Rechnungsadresse; erst wenn der Provider sie angenommen hat, gilt die Anpassung als angekündigt,
  sonst bleibt der Zyklus offen. Eine Ankündigung lässt sich zurückziehen, solange keine Rechnung sie
  angewendet hat (mit Rückfrage); den Kunden informiert dann der Owner selbst. Meldet der
  Zustell-Webhook die Mail als unzustellbar, wird eine noch nicht angewendete Anpassung zurückgezogen
  und eine Aufgabe am Vertrag angelegt, damit nie ein unangekündigter Preis gilt. Abschalten der
  Wertsicherung verlangt erst das Zurückziehen; eine Kündigung vor dem Stichtag zieht sie zurück. `contract_adjustments` hält je Zyklus
  alte und neue Positionen, Werte und Status (keine Anpassung, angekündigt, angewendet, zurückgezogen).
- **Anwendung**: Die Abrechnung des ersten Zeitraums ab dem Stichtag übernimmt die neuen Positionen in
  den Vertrag und setzt die Basis auf den neuen Wert, unter der Sperre des Vertrags. Weil sich die
  Positionen ändern, geht diese Rechnung im Automatikmodus über die Freigabe (ADR-0073).
- **Erinnerung**: Der stündliche Job legt zwei Wochen vor dem Tag, an dem die Ankündigung spätestens
  hinaus muss, die Aufgabe „Wertsicherung prüfen“ am Vertrag an, einmal je Zyklus
  (`tasks.contract_id`); sie erledigt sich mit der Eintragung.
- **Stundenkontingent**: Minuten je Zeitraum und ein Stundensatz am Vertrag, aus dem Angebot übernommen
  (nur für das kürzeste Intervall, sonst zählte das Kontingent doppelt). Zeit wird am Vertrag erfasst
  (`contract_time_entries`). Was über das Kontingent geht, wird auf die Viertelstunde aufgerundet und als
  Position „Zusätzliche Stunden“ mit der Liste der Tätigkeiten berechnet: im Voraus mit der Rechnung des
  folgenden Zeitraums, nachträglich mit der des Zeitraums selbst. Angebrochene Zeiträume bekommen das
  Kontingent anteilig nach Tagen; nicht genutzte Stunden verfallen. Einträge bis `overage_billed_until`
  sind gesperrt, außer im zuletzt abgerechneten Zeitraum, solange dessen Rechnung ein Entwurf ist: ein
  nachgetragener oder gelöschter Eintrag aktualisiert dann die Position im Entwurf. Ohne Stundensatz
  sperren die Einträge genauso, sobald ihr Zeitraum abgerechnet ist. Nach dem Ende eines im Voraus abgerechneten Vertrags legt der
  Job für die Stunden des letzten Zeitraums eine eigene Rechnung an. Ohne Stundensatz wird Zeit nur
  dokumentiert.

## ADR-0076 · Projekt-Dashboard: was Angebote, Rechnungen und Verträge einbringen (2026-10-23)

Phase 7c-5 (ZIELPROMPT §7.10). Ein vierter Reiter „Geschäft“ unter Auswertung zeigt die Kennzahlen aus
Angeboten, Rechnungen und Wartungsverträgen, mit demselben Zeitraum, denselben Filtern und demselben
CSV-Export (`teil=geschaeft`) wie die übrigen Dashboards.

- **Angebotsvolumen**: Angebote, die im Zeitraum versendet wurden, netto bewertet: einmalige Positionen
  plus zwölf Monate der laufenden. Ein angenommenes Angebot zählt mit der angenommenen Version und
  Auswahl, sonst die zuletzt versendete Version mit der Standardauswahl. Maßgeblich ist das
  letzte Versanddatum: Wird ein Angebot nach einer Änderung erneut versendet, wandert es in den Zeitraum
  des neuen Versands, so wie es auch inhaltlich das neue Angebot ist.
- **Annahmequote und Ø Zeit bis zur Annahme**: bezogen auf die im Zeitraum beantworteten Angebote
  (angenommen oder abgelehnt); zurückgezogene und offene zählen nicht, sonst sänke die Quote mit jedem
  frisch versendeten Angebot. Die Tage laufen vom Versand bis zur Online-Annahme.
- **Umsatz**: ausgestellte Rechnungen nach Rechnungsdatum, netto abzüglich angerechneter Anzahlungen,
  damit Teil- und Schlussrechnung nichts doppelt zählen. Ein Storno zählt negativ in seinem eigenen
  Zeitraum, die stornierte Rechnung bleibt in ihrem. Aufgeteilt nach der Kampagne, über die der Kunde
  kam; „Ohne Kampagne“ steht immer zuletzt.
- **Offene Posten und MRR** sind aktueller Stand und hängen nicht vom Zeitraum ab: offene Beträge
  ausgestellter Rechnungen (brutto, nach Zahlungen) mit dem überfälligen Anteil, und die monatlich
  umgelegten Netto-Beträge der heute laufenden Wartungsverträge. Kunden mit Sperrvermerk zählen beim
  MRR nicht, weil ihre Verträge nicht mehr abgerechnet werden.
- Alle Abfragen laufen als Mandant und verbinden den Kunden, damit Kampagne, Branche, Region und Tag für
  jede Zahl gelten. Trends vergleichen mit der gleich langen Vorperiode.
