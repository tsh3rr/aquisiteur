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
- [x] CSRF: Cockpit-Änderungen nur über Server Actions (Origin-Prüfung von Next.js). Öffentliche
      POST-Routen lehnen fremde `Origin` ab (`isCrossSite`).
- [x] Größenlimits gelesen am Datenstrom, nicht nur am `Content-Length`-Header (`src/lib/body.ts`):
      Tracking 32 KB, Replay-Stück 256 KB, Pingen-Webhook 256 KB, Exposé-JSON 2 MB, Brief-PDF 8 MB,
      Upload 40 MB.
- [x] Schema-Validierung (Zod) jeder Eingabe von außen.

## Öffentliche Exposés und Kurzlinks

- [x] Exposé-Adressen mit 10 zufälligen Zeichen (`randomCode`, ohne Modulo-Verzerrung).
- [x] Kurzlinks sind bewusst kurz (aus dem Brief abtippbar). Schutz gegen Durchprobieren: nach 20
      unbekannten Codes in 10 Minuten bekommt ein Client weder Vorschläge noch Weiterleitungen, bis das
      Fenster endet (`src/server/tracking/short-link-guard.ts`). Der Client ist ein Hash aus Secret und
      IP-Adresse; die Adresse selbst wird nicht gespeichert. Zusätzlich höchstens 300 Vorschlagslisten
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
- [x] Webhooks (`/api/webhooks/pingen/<workspace_id>`): ohne Cockpit-Anmeldung erreichbar
      (`src/middleware.ts`), dafür HMAC-SHA256 über den Rohtext mit dem Signaturschlüssel des Workspaces,
      in konstanter Zeit verglichen; ohne hinterlegten Schlüssel 401. Body vor der Prüfung höchstens
      256 KB. Doppelte Meldungen ändern nichts (ADR-0063).
- [x] Pingen-Tokens im Speicher nach Umgebung, Client-ID und Secret getrennt, nie über Workspaces
      hinweg geteilt.
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
