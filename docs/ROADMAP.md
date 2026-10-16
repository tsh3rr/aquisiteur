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

- [ ] Kontaktblock mit allen v1-Kanälen, Live-Chat (Realtime-Port), Rückruf, Entwurfserkennung, Nudges

## Phase 4 · Intent & Benachrichtigung

- [ ] Score-Engine (Noisy-OR), Erklärung + Empfehlung, Regel-Engine, Push + E-Mail, Digest, „Heute“-Ansicht
- [ ] E2E-Kernpfad: QR öffnen → lesen → Chat tippen → Owner sieht Score und Benachrichtigung

## Phase 5 · Brief & Auswertung

- [ ] Dashboards (Übersicht, Kampagne, Inhalt), Karte, Funnel, Heatmaps
- [ ] Brief-PDF (DIN 5008), Sammel-Export, Versand-Schnittstelle mit `manual`-Provider und Lebenszyklus
- [ ] Consent + Session-Replay

## Phase 6 · Härtung

- [ ] Retention-Jobs (inkl. `rate_limits`), Datenexport/-löschung pro Prospect und Workspace
- [ ] Security-Checkliste, Monitoring (Sentry EU), Datenschutzseiten, `docs/PRIVACY.md` vollständig
- [ ] Einstellungen → System mit Limits

## Später

- [ ] Pingen-Adapter (erster echter Druck-Provider), danach ggf. LetterXpress, Handschrift-Dienst; automatische Follow-ups
- [ ] Messenger, SMS, Telegram, A/B-Varianten, KI-Assistent für Exposé-Entwürfe
- [ ] SaaS-Launch: Registrierung, Teams, Stripe, Plattform-Admin, Landingpage
