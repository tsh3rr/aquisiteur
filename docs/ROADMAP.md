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

- [ ] Exposé-Schema (Zod) + `schema/expose.schema.json`
- [ ] CLI `pnpm expose:validate` / `pnpm expose:publish`, REST `POST /api/exposes` mit API-Token
- [ ] API-Token-Verwaltung in den Einstellungen
- [ ] Storage-Port (R2 über S3-API), Bildoptimierung mit `sharp` beim Veröffentlichen
- [ ] Blockbibliothek (15 Blöcke), öffentliches Rendering, Theming mit Kontrastkorrektur
- [ ] Exposé-Versionierung, Vorschau im Cockpit (Desktop/Mobil)
- [ ] CSP-Strategie für gecachte Exposés (ADR-0007)
- [ ] Zwei Beispiel-Exposés als Seed (Café, Handwerksbetrieb) mit Beispiel-Prospects
- [ ] `docs/EXPOSE_AUTHORING.md`
- [ ] Logo und Owner-Foto im Wizard
- [ ] Lighthouse CI

## Phase 2 · Links & Tracking

- [ ] Kundenliste mit Filtern und gespeicherten Ansichten, Pipeline (Kanban), Kunden-Detailseite
- [ ] Touchpoints, Kurzlinks, QR-Export (SVG/PNG), Resolver mit „Meinten Sie …?“
- [ ] Bot-/Prefetch- und Internal-Filter
- [ ] Tracking-Script (< 5 KB, cookieless), Event-Ingestion mit Rate-Limit, Timeline
- [ ] Isolationstest erweitert um neue Tabellen und API-Tokens

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
