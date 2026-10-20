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
- Der Code auf dem Brief: Punkte statt Quadrate, runde Ecken-Augen in der Akzentfarbe und ein „Hi!“ in
  der Mitte, deshalb Fehlerkorrektur H. Das Label „Scannen“ steht unter dem Code, außerhalb der Module. Mit einem
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
