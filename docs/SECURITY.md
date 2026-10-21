# Sicherheit (Checkliste §10)

Stand Phase 6. Jeder Punkt nennt, wo er umgesetzt ist und womit er geprüft wird. Neue Features gehen
diese Liste durch, bevor sie als fertig gelten.

## Anmeldung und Sitzungen

- [x] Nur Passkey oder Magic Link, kein Passwort (`src/server/auth.ts`). Anmeldelinks 10 Minuten
      gültig, einmalig, nur als Hash gespeichert.
- [x] Sitzungen 3 Tage, täglich verlängert; Cookie `aq.session_token` httpOnly, `SameSite=Lax`,
      `Secure` unter HTTPS. Abgelaufene Sitzungen löscht der stündliche Job (ADR-0043).
- [x] Kein offenes Registrieren: `SIGNUP_ALLOWLIST`.
- [x] Rate Limit der Anmeldung: 5 Magic Links pro 10 Minuten, 10 Passkey-Anfragen pro Minute, sonst
      30 pro Minute (Better Auth, Tabelle `rate_limits`).

## Mandantentrennung

- [x] Row Level Security auf allen Tabellen mit Workspace-Daten, Tenant-Rolle ohne `BYPASSRLS`
      (`drizzle/0000`, `withTenant()`). Geprüft in `tests/db/tenant-isolation.test.ts`, inklusive
      Leitplanke, dass jede neue Tabelle RLS hat.
- [x] Öffentliche Routen laufen auf der System-Verbindung, aber jede Abfrage nennt den Workspace des
      Hosts (ADR-0012). API-Tokens handeln als Tenant mit den Rechten ihres Erstellers.
- [x] Dateien nur unter `<workspace_id>/`, ausgeliefert nur für den Host des eigenen Workspaces.
- [x] Realtime-Kanäle mit HMAC-Namen, nicht erratbar.
- [x] Berechtigungen zentral über `can()` / `assertCan()`.

## Anfragen und Header

- [x] CSP pro Anfrage mit Nonce und `strict-dynamic`, `frame-ancestors 'none'` (Vorschau: `'self'`),
      `object-src 'none'`, `form-action 'self'` (`src/lib/security-headers.ts`, `src/middleware.ts`).
- [x] `'wasm-unsafe-eval'` (nur WebAssembly, kein JS-`eval`) und `connect-src data:` im Cockpit und auf
      den Exposé-Hosts, für die PDF-Layout-Engine von Brief und Exposé-PDF (ADR-0037, ADR-0059).
- [x] HSTS (2 Jahre, `includeSubDomains`, `preload`), `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
      `Cross-Origin-Opener-Policy`, `Permissions-Policy`. Geprüft in `security-headers.test.ts`.
- [x] `X-Robots-Tag: noindex, nofollow` überall.
- [x] Client-Adresse an einer Stelle: Die Middleware setzt `x-aquisiteur-client-ip` und überschreibt
      einen mitgeschickten Wert. Cloudflare-Header (`cf-*`) gelten nur mit `ORIGIN_SECRET` oder auf
      Workers, sonst zählt der letzte Eintrag in `x-forwarded-for` (vom Proxy davor) und `cf-*` wird
      verworfen (`src/lib/client-ip.ts`, ADR-0063).
- [x] Origin-Schutz für den Betrieb hinter eigenem Cloudflare: Mit `ORIGIN_SECRET` antwortet die App
      nur auf Anfragen mit dem Header, den Cloudflare per Transform Rule setzt.
- [x] Grenzen unabhängig von der Adresse: höchstens 6 Anmeldelinks pro E-Mail-Adresse und Stunde,
      höchstens 200 unbekannte Kurzlinks pro Workspace und Stunde (danach lösen nur noch QR-Codes auf).
- [x] Weiterleitung nach der Anmeldung nur auf Pfade im Cockpit (`safeNextPath`, auch gegen `/\host`).
- [x] CSRF: Cockpit-Änderungen nur über Server Actions (Origin-Prüfung von Next.js). Öffentliche
      POST-Routen lehnen fremde `Origin` ab (`isCrossSite`).
- [x] Größenlimits gelesen am Datenstrom, nicht nur am `Content-Length`-Header (`src/lib/body.ts`):
      Tracking 32 KB, Replay-Stück 256 KB, Exposé-JSON 2 MB, Upload 40 MB.
- [x] Schema-Validierung (Zod) jeder Eingabe von außen.

## Öffentliche Exposés und Kurzlinks

- [x] Exposé-Adressen mit 10 zufälligen Zeichen (`randomCode`, ohne Modulo-Verzerrung).
- [x] Kurzlinks sind bewusst kurz (aus dem Brief abtippbar). Schutz gegen Durchprobieren: nach 20
      unbekannten Codes in 10 Minuten bekommt ein Client weder Vorschläge noch Weiterleitungen, bis das
      Fenster endet (`src/server/tracking/short-link-guard.ts`). Der Client ist ein Hash aus Secret und
      IP-Adresse, bei IPv6 das /64-Netz (ADR-0063); die Adresse selbst wird nicht gespeichert. Zusätzlich höchstens 300 Vorschlagslisten
      pro Workspace in 10 Minuten. Geprüft in `tests/db/short-link-guard.test.ts`.
- [x] Rate Limits pro Besuch und Exposé für Tracking, Chat, Rückruf, Teilen, Einwilligung und Replay.
- [x] Chat und Rückruf: Honeypot, Rate Limit, Ausgabe nur als Text (React), nie als HTML.
- [x] Exposé-Texte und Rechtstexte: eigenes Markdown-Subset, als React-Elemente gerendert; Links nur
      `https`, `mailto`, `tel`.
- [x] Uploads: erlaubte Formate je Art, Inhalt per Magic Bytes geprüft, Maße und Größe begrenzt, SVG vor
      dem Upload gerastert (ADR-0013).

## Geheimnisse

- [x] Secrets nur in Umgebungsvariablen, dokumentiert in `.env.example`; `pnpm deploy:secrets` erzeugt
      sie. Nichts Workspace-Spezifisches in Env.
- [x] Zugangsdaten von Integrationen AES-256-GCM-verschlüsselt in der DB, Kontext gebunden.
- [x] API-Tokens nur als SHA-256-Hash, einmal angezeigt, ablaufend und widerrufbar. Kein eigenes Rate
      Limit für falsche Tokens: bei rund 190 Bit Zufall ist Raten aussichtslos.
- [x] Cron-Secret für `/api/jobs/hourly` in konstanter Zeit verglichen.
- [x] Exporte enthalten keine Token-Hashes und keine verschlüsselten Zugangsdaten.

## Betrieb

- [x] Fehler-Monitoring über Sentry EU, nur Routenmuster, keine Pfade, Header, IPs oder Nutzerdaten
      (ADR-0044).
- [x] Audit-Log pro Workspace, für Mandanten nur anfügbar.
- [x] Abhängigkeiten: `pnpm audit --prod --audit-level high` in der CI. Stand 2026-10-16: eine mittlere
      Meldung in `esbuild` (Dev-Server), nur über `drizzle-kit` als Entwicklungswerkzeug erreichbar, nicht
      im ausgelieferten Worker.
- [x] Migrationen halten die vorige App-Version lauffähig; Deploy migriert zuerst (ADR-0036).

## Bewusst offen

- Plattform-Admin-Oberfläche, Einladungen und Teams gibt es erst mit dem SaaS-Start; die Rollen sind
  im Modell und in `can()` schon vorhanden.
- Kein WAF-Regelwerk über das hinaus, was Cloudflare im Free-Plan mitbringt.

## Security-Audit vor dem Go-live (2026-10-21)

Pflicht laut ZIELPROMPT §10 und §14. Geprüft wurden Anmeldung und Sitzungen, Mandantentrennung (RLS,
`withTenant`, alle Server Actions und Route Handler auf Sitzung und `can()`), öffentliche Routen
(Exposé, Kurzlinks, Tracking, Chat, Rückruf, Replay, Opt-out), Eingabevalidierung und Größenlimits,
Rate Limits, Ausgabe von Nutzereingaben (React, Markdown-Subset, E-Mail-Vorlagen, CSV), Secrets und
Konfiguration, Header und CSP, Abhängigkeiten (`pnpm audit --prod`), Deployment (Dockerfile, Compose,
Workflows) und Datenschutz. Schweregrade: kritisch, hoch, mittel, niedrig.

**Kritisch:** keine Befunde.

### Hoch

| Nr. | Befund                                                                                                                                                                                                                                                                                                                                                                                                       | Stand                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Die App glaubte `cf-connecting-ip`, auch ohne dass Cloudflare garantiert davorsteht. Im heutigen Betrieb (Mikrus-Proxy, kein eigenes Cloudflare) und beim direkten Aufruf des Servers über IPv6 kann jeder Besucher diesen Header selbst schicken: Kurzlink-Sperre und Rate Limit der Anmeldelinks greifen dann nicht (Kurzlinks durchprobieren, Mailflut an die eigene Adresse), Ort der Besuche fälschbar. | Behoben: Cloudflare-Header nur noch mit `ORIGIN_SECRET` oder auf Workers, sonst der Eintrag des Proxys davor; zusätzlich Grenzen pro E-Mail-Adresse und pro Workspace, die keine Adresse brauchen (ADR-0063). Rest-Risiko: Wer den Server direkt anspricht, kann seine Adresse weiter wählen, kommt aber nicht über die festen Grenzen hinaus. |
| H2  | Kurzlink-Sperre zählte jede IPv6-Adresse einzeln. Ein Anschluss hat meist ein ganzes /64-Netz und kann für jede Anfrage eine neue Adresse nehmen, die Sperre lief damit ins Leere.                                                                                                                                                                                                                           | Behoben: Zählung pro /64 (`src/lib/client-ip.ts`), mit Tests.                                                                                                                                                                                                                                                                                  |

### Mittel

| Nr. | Befund                                                                                                                                                                                                                                                                                                                 | Stand                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1  | Offene Weiterleitung nach der Anmeldung: `/login?next=/\fremde-seite.de` führte nach dem Login auf eine fremde Seite (Browser lesen `/\` wie `//`). Nutzbar für Phishing mit echtem Anmeldelink.                                                                                                                       | Behoben (`src/domain/redirect.ts`, mit Tests).                                                                                                                                             |
| M2  | Wer die Adresse eines Exposés kennt, kann pro Exposé 60 Besuchsstarts in 10 Minuten verbrauchen. Der echte Empfänger bekommt dann keinen Besuchs-Token und damit keinen Chat. Zugleich sind bis zu 60 × 30 Chat-Nachrichten in 10 Minuten pro Exposé möglich. Voraussetzung: die zufällige Exposé-Adresse ist bekannt. | Offen, bis zum SaaS-Start: Grenze zusätzlich pro Client (/64) statt nur pro Exposé, Obergrenze für Chat-Nachrichten pro Exposé.                                                            |
| M3  | Entwurfserkennung maß die Länge ungesendeter Chat-Eingaben ohne Einwilligung; mit `chat.storeDraftContent` sogar den Text. Rechtlich nicht eindeutig (§ 25 TDDDG, Art. 6 DSGVO).                                                                                                                                       | Behoben (ADR-0064): nur noch ja/nein, kein Text, keine Länge, Option entfernt, alte Daten bereinigt; in der Datenschutzerklärung genannt. Live-Feed zeigt nur noch „ist gerade im Exposé“. |
| M4  | `deploy/env.example` setzt `ALLOW_LOG_EMAIL=1` (für den Testserver ohne Mail). Bleibt das in Produktion stehen, stehen Anmeldelinks im Log, und wer die Logs lesen kann, kann sich anmelden.                                                                                                                           | Go-live-Checkliste unten.                                                                                                                                                                  |

### Niedrig

| Nr. | Befund                                                                                                                                                                                                     | Stand                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| N1  | Push-Abos nehmen jede `https`-Adresse als Endpunkt; der Server schickt dorthin Anfragen. Nur angemeldete Mitglieder können das, heute also nur der Owner.                                                  | Vor dem SaaS-Start auf die bekannten Push-Dienste beschränken (Google, Apple, Mozilla, Microsoft). |
| N2  | Eine eigene Domain wird beim Eintragen ohne Nachweis für den Workspace reserviert (Status `pending`) und ist damit für andere gesperrt. Ausgeliefert wird sie erst als `active`.                           | Vor dem SaaS-Start DNS-Nachweis (TXT-Eintrag).                                                     |
| N3  | Live-Streams (SSE, `memory`) ohne Grenze für gleichzeitige Verbindungen pro Token; Live-Tokens gelten 12 Stunden, auch nach dem Abmelden.                                                                  | Beobachten; bei Bedarf Grenze pro Token.                                                           |
| N4  | GitHub Actions sind per Versions-Tag statt per Commit-SHA eingebunden; die Deploy-Workflows haben SSH-Schlüssel zu den Servern.                                                                            | Empfehlung: auf Commit-SHA pinnen, Dependabot für Actions.                                         |
| N5  | Cockpit-CSP erlaubt Bilder und Schriften von jeder `https`-Quelle (Karte, Replay). Ohne Nutzer-HTML im Cockpit kein Einfallstor, aber weniger Tiefe.                                                       | Bewusst so (ADR-0037); bei neuen Funktionen mit fremden Inhalten neu bewerten.                     |
| N6  | Cloudflare-Variante mit Supabase Realtime: Besucher können in den Kanal ihres eigenen Chats senden. Die Clients laden nach jedem Ereignis vom Server nach. Betrifft die Produktion (Node, `memory`) nicht. | Bei Wechsel auf Workers private Kanäle prüfen.                                                     |

**Abhängigkeiten:** `pnpm audit --prod` am 2026-10-21: eine mittlere Meldung in `esbuild` (nur
Entwicklungsserver über `drizzle-kit`), nichts im ausgelieferten Code. Next.js 16.4.1 und Better Auth
1.7.10 sind aktuell.

**Ohne Befund:** RLS und Isolationstest, Server Actions und Route Handler (alle mit Sitzung und `can()`),
API-Tokens, Cron-Secret, signierte Tokens (HMAC, Ablauf, Zweck), Größenlimits, Zod an allen Eingängen,
keine HTML-Ausgabe von Nutzereingaben (kein `dangerouslySetInnerHTML`), Links nur `https`/`mailto`/`tel`,
CSV-Injection-Schutz, E-Mail-Vorlagen escaped, Uploads mit Magic Bytes, Replay maskiert Eingaben,
Sitzungsdauer, Magic-Link-Allowlist, CSP mit Nonce, HSTS, Container läuft als `node`.

### Go-live-Checkliste Sicherheit

1. Heute (Mikrus-Proxy, Docker Compose): `ORIGIN_SECRET` leer lassen. Nur wer später ein eigenes
   Cloudflare davorschaltet: erst die Transform Rule „Origin-Schutz“ anlegen, dann `ORIGIN_SECRET`
   setzen (`docs/DEPLOY.md` Schritt 4 und 8); dann ergibt ein direkter Aufruf des Servers 403.
2. `EMAIL_PROVIDER=resend`, `ALLOW_LOG_EMAIL` gelöscht.
3. Alle Secrets frisch aus `pnpm deploy:secrets`, nicht vom Testserver übernommen; Staging und
   Produktion mit verschiedenen Secrets.
4. `SIGNUP_ALLOWLIST` enthält nur die eigene Adresse.
5. Kurz vor dem Go-live von außen prüfen: Header (securityheaders.com), TLS (SSL Labs), offene Ports
   (nur SSH und der Port für den Mikrus-Proxy).
6. Der offene mittlere Befund M2 hat einen Termin oder eine begründete Ausnahme.
