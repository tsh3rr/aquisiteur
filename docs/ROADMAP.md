# Roadmap

Phasen laut ZIELPROMPT §13. Jede Phase endet lauffähig, getestet, mit Demo-Anleitung.

## Phase 0 · Fundament ✅

Fertig, wenn: Owner legt per Wizard seinen Workspace an, sieht leeres Cockpit, Isolationstest zwischen
zwei Workspaces grün, CI grün.

- [x] Repo-Setup (pnpm, Next.js 16, TypeScript strict, Tailwind 4, Prettier, ESLint)
- [x] CI (GitHub Actions): Lint, Format, Typecheck, Unit, DB-Tests, E2E mit axe, Cloudflare-Build
- [x] `src/infra/`-Ports mit Lint-Regel und Test der Regel
- [x] Design Tokens (OKLCH, Hell/Dunkel, Kontrasttest) und Design-System-Seite `/design`
- [x] Auth: Magic Link + Passkey (Better Auth), Allowlist statt öffentlicher Registrierung
- [x] Mandantenfähiges Schema: Workspaces, Memberships, Settings, Domains, Integrations, Usage, API-Tokens, Audit-Log
- [x] RLS mit Tenant-Rolle, Isolationstest inkl. Schema-Leitplanken
- [x] Host-basiertes Routing (Cockpit, Plattform-Subdomain, eigene Domain)
- [x] `can()`, `entitlements()`, verschlüsselte Integration-Secrets
- [x] Onboarding-Wizard (Workspace, Profil & Kanäle, Absender & Domain, Passkey)
- [x] Leeres Cockpit („Heute“, Einstellungen)
- [x] Seed (`pnpm db:seed`)
- [x] Doku: CLAUDE.md, ARCHITECTURE, DECISIONS, ROADMAP, HOSTING, DEPLOY

Bewusst verschoben: Logo-Upload im Wizard (braucht Storage, Phase 1), Limit-Übersicht unter
Einstellungen → System (sobald es Messwerte gibt, spätestens Phase 6).

## Phase 1 · Exposé-Hosting

Fertig, wenn: Beispiel-Exposé per CLI veröffentlicht, Lighthouse ≥ 95, axe 0 Verstöße.

- [x] Exposé-Schema (Zod) + `schema/expose.schema.json`
- [x] CLI `pnpm expose:validate` / `pnpm expose:publish`, REST `/api/v1/assets` + `/api/v1/exposes` mit API-Token
- [x] API-Token-Verwaltung in den Einstellungen
- [x] Storage-Port (R2 über S3-API, lokal als Fallback), Bildoptimierung mit `sharp` in der CLI (ADR-0013)
- [x] Blockbibliothek (15 Blöcke), öffentliches Rendering, Theming mit Kontrastkorrektur
- [x] Exposé-Versionierung, Vorschau im Cockpit (Desktop/Mobil), offline nehmen
- [x] CSP-Strategie für Exposés (ADR-0012: pro Anfrage gerendert, Nonce bleibt)
- [x] Zwei Beispiel-Exposés als Seed (Café, Handwerksbetrieb) mit Beispiel-Prospects
- [x] `docs/EXPOSE_AUTHORING.md`
- [x] Logo und Owner-Foto im Wizard und in den Einstellungen
- [x] Lighthouse CI (ADR-0014: gemessen 93–97 Performance, sonst je 100)
- [x] Opt-out „Kein Interesse“ mit Bestätigung (ADR-0015)
- [x] `pnpm user:login`: Account und Anmeldelink ohne E-Mail-Versand

## Phase 2 · Links & Tracking

- [x] Kundenliste mit Filtern und gespeicherten Ansichten, Pipeline (Kanban), Kunden-Detailseite
- [x] Touchpoints, Kurzlinks, QR-Export (SVG/PNG), Resolver mit „Meinten Sie …?“
- [x] Bot-/Prefetch- und Internal-Filter
- [x] Tracking-Script (< 5 KB, cookieless), Event-Ingestion mit Rate-Limit, Timeline
- [x] Isolationstest erweitert um neue Tabellen und API-Tokens

## Phase 3 · Kontakt & Chat

- [x] Kontaktblock mit allen v1-Kanälen (Chat, WhatsApp, Telefon, Rückruf, E-Mail, Termin, Messenger, SMS)
- [x] Live-Chat Handy ↔ Cockpit über den Realtime-Port (ADR-0020), Tippanzeige, Rückkanal, WhatsApp-Übergabe
- [x] Rückrufwunsch, Abwesenheitsnotiz (ADR-0022), Verfügbarkeit (ADR-0026)
- [x] Entwurfserkennung (ADR-0023), Nudges (max. einer pro Seitenaufruf), Sticky-Kontaktleiste mobil
- [x] Status „Kontakt“ automatisch (ADR-0024), Chats und Rückrufe in „Heute“ und auf der Kundenseite

## Phase 4 · Intent & Benachrichtigung

- [x] Score-Engine (Noisy-OR), Erklärung + Empfehlung mit Ein-Klick-Aktionen (ADR-0028), gewichtbar in den Einstellungen
- [x] Regel-Engine mit Bündelung, Ruhezeit, nur werktags (ADR-0029), Push (ADR-0030, ADR-0034) + E-Mail
- [x] Tageszusammenfassung über stündlichen Job (ADR-0032), Benachrichtigungsliste mit Live-Zähler
- [x] „Heute“: wer jetzt eine Reaktion braucht, Live-Feed „Jetzt gerade“; Score auf Kundenseite und in der Liste
- [x] E2E-Kernpfad: QR öffnen → lesen → Chat tippen → Owner sieht Score und Benachrichtigung
- [ ] Push auf dem echten Handy nach dem Deploy prüfen (Einstellungen → Benachrichtigungen → „Test senden“)

## Phase 5 · Brief & Auswertung

- [x] Dashboards (Übersicht, Kampagne, Inhalt) mit Trend, Funnel und Kampagnenvergleich, Wochentag-×-Uhrzeit-Heatmap, Abschnitts-Heatmap pro Kunde, CSV-Export (ADR-0040)
- [x] Karte mit stündlicher Ortssuche über Nominatim (ADR-0041)
- [x] Kampagnen und CSV-Import (ADR-0039)
- [x] Brief-PDF (DIN 5008) im Browser, Sammel-PDF, Versand-Schnittstelle mit `manual`-Provider und Lebenszyklus (ADR-0037, ADR-0038)
- [x] Consent + Session-Replay mit Löschung nach Frist und bei Widerruf (ADR-0042)
- [x] E2E: Kampagne von Import bis Auswertung (`tests/e2e/campaign.spec.ts`)

## Phase 6 · Härtung

- [x] Retention-Jobs (inkl. `rate_limits`), Datenexport/-löschung pro Prospect und Workspace (ADR-0043)
- [x] Security-Checkliste (`docs/SECURITY.md`), Monitoring (Sentry EU, ADR-0044), Datenschutzseiten, `docs/PRIVACY.md` vollständig
- [x] Einstellungen → System mit Limits (ADR-0045)
- [x] CPU-Grenze des Free-Plans gemessen (ADR-0046); Betrieb auf eigenem Server mit Coolify (ADR-0047)

## Später

- [ ] Exposés vorrendern (ISR mit OpenNext-Cache), falls Aquisiteur zurück auf den Cloudflare-Free-Plan zieht (ADR-0046)
- [ ] Pingen-Adapter (erster echter Druck-Provider), danach ggf. LetterXpress, Handschrift-Dienst; automatische Follow-ups
- [ ] Messenger, SMS, Telegram, A/B-Varianten, KI-Assistent für Exposé-Entwürfe
- [ ] SaaS-Launch: Registrierung, Teams, Stripe, Plattform-Admin, Landingpage
