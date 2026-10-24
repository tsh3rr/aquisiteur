# Aquisiteur

Neukundengewinnung per persönlichem Brief: QR-Code und Kurzlink im Brief führen zu einem interaktiven
Exposé, Aquisiteur misst DSGVO-konform jede Interaktion und sagt dir, wer wie sicher Kontakt aufnehmen
will und über welchen Kanal du jetzt reagieren solltest.

Spezifikation: [ZIELPROMPT.md](./ZIELPROMPT.md) · Stand: Phasen 0–6 fertig, offen ist der Abschnitt „Später“, siehe [docs/ROADMAP.md](./docs/ROADMAP.md).

## Lokal starten

Voraussetzungen: Node.js 22+, pnpm 10, Postgres 16.

```bash
pnpm install
cp .env.example .env          # Werte prüfen
createuser -P aquisiteur      # Passwort: aquisiteur (oder DATABASE_URL anpassen)
createdb -O aquisiteur aquisiteur && createdb -O aquisiteur aquisiteur_test
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Dann <http://localhost:3000> öffnen und mit `owner@example.com` anmelden. Der Anmeldelink erscheint im
Terminal von `pnpm dev`. Für den Einrichtungs-Assistenten eine weitere Adresse in `SIGNUP_ALLOWLIST`
eintragen und damit anmelden.

## Demo Phase 0

1. Mit einer freigeschalteten Adresse anmelden, Link aus dem Terminal öffnen.
2. Assistent: Workspace-Name (die Adresse wird automatisch vorgeschlagen), Profil & Kanäle, Absender & Domain, Passkey.
3. Leeres Cockpit „Heute“, Einstellungen mit Passkey-Verwaltung, Design-System unter `/design`.
4. Öffentliche Workspace-Seite: `http://<slug>.localhost:3000`.

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test         # Unit
pnpm test:db      # Mandantentrennung gegen echtes Postgres
pnpm test:e2e     # Playwright + axe, alle Bildschirme und Kernpfade
```

## Doku

- [Deployment auf eigenem Server (Mikrus, Docker Compose)](./docs/DEPLOY.md) · [Exposés schreiben](./docs/EXPOSE_AUTHORING.md) · [Sicherheit](./docs/SECURITY.md)
- [Architektur](./docs/ARCHITECTURE.md) · [Entscheidungen](./docs/DECISIONS.md) · [Hosting-Umzug](./docs/HOSTING.md) · [Datenschutz](./docs/PRIVACY.md)
