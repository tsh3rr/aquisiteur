# Deployment: Cloudflare Workers + Supabase

Schritt-für-Schritt-Anleitung, um Aquisiteur produktiv zu betreiben. Stand: Phase 0 (Fundament).
Zeitaufwand beim ersten Mal: etwa eine Stunde.

> Kurz gesagt: Supabase liefert die Postgres-Datenbank in Frankfurt, Cloudflare Hyperdrive verbindet
> den Worker schnell mit ihr, Cloudflare Workers führt die Next.js-App aus. Migrationen spielst du
> von deinem Rechner (oder später aus GitHub Actions) direkt gegen Supabase ein.

## Überblick

```
Browser ──► Cloudflare Worker (Next.js via OpenNext)
                 │  Binding HYPERDRIVE
                 ▼
           Cloudflare Hyperdrive (Connection-Pool an der Edge)
                 │
                 ▼
           Supabase Postgres (Region eu-central-1, Frankfurt)
```

| Was           | Wo                             | Wofür                                                     |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| Datenbank     | Supabase, Region **Frankfurt** | Alle Daten inkl. Logins (Better Auth)                     |
| App           | Cloudflare Workers (Paid Plan) | Cockpit, Exposés, Kurzlinks                               |
| DB-Verbindung | Cloudflare Hyperdrive          | Pooling, damit der Worker nicht pro Anfrage neu verbindet |
| E-Mail        | Resend (EU-Region)             | Anmeldelinks, später Benachrichtigungen                   |

## Voraussetzungen

- Node.js 22 oder neuer und pnpm 10 (`corepack enable` aktiviert pnpm)
- Ein Cloudflare-Konto mit **Workers Paid** (5 $/Monat) und deiner Domain als Zone in Cloudflare
- Ein Supabase-Konto
- Ein Resend-Konto (kostenloser Plan reicht für den Anfang)
- Lokal ein Klon des Repos: `git clone https://github.com/tsh3rr/aquisiteur && cd aquisiteur && pnpm install`

## 1. Domains festlegen

Du brauchst zwei Dinge (Beispiel mit `aquisiteur.de`, ersetze durch deine Domain):

| Zweck                           | Beispiel                                                           | Env-Variable                        |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Cockpit                         | `app.aquisiteur.de`                                                | `APP_URL=https://app.aquisiteur.de` |
| Plattform-Domain für Workspaces | `aquisiteur.de` → Workspace-Adressen wie `pixelwerk.aquisiteur.de` | `PLATFORM_DOMAIN=aquisiteur.de`     |

Später kann jeder Workspace zusätzlich eine eigene Domain bekommen (z. B. `go.pixelwerk.de`); das richten
wir mit der Exposé-Veröffentlichung ein.

## 2. Supabase-Datenbank anlegen

1. Auf [supabase.com](https://supabase.com) → **New project**.
2. Name: `aquisiteur`, **Region: Central EU (Frankfurt)**, ein starkes Datenbank-Passwort erzeugen und im
   Passwortmanager speichern.
3. Nach dem Anlegen: **Project Settings → Data API** → bei _Exposed schemas_ `public` entfernen (oder die
   Data API ganz deaktivieren). Aquisiteur spricht nur direkt per Postgres mit der Datenbank; die
   REST-API von Supabase wird nicht gebraucht. Alle Tabellen haben zusätzlich Row Level Security.
4. **Connect** (oben im Projekt) → **Connection string** → **Session pooler** kopieren. Er sieht so aus:

   ```
   postgres://postgres.<project-ref>:<DEIN-PASSWORT>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   Den Session Pooler (Port **5432**) nutzen, nicht den Transaction Pooler (Port 6543): Aquisiteur setzt
   pro Transaktion eine Datenbankrolle und Variablen für die Mandantentrennung.

## 3. Migrationen einspielen

Lokal im Repo, mit dem Connection-String aus Schritt 2:

```bash
DATABASE_URL='postgres://postgres.<ref>:<passwort>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres' pnpm db:migrate
```

Das legt alle Tabellen, die Rolle `aquisiteur_app` (für RLS) und die Hilfsfunktionen an. Der Befehl ist
wiederholbar; bei jedem Update der App erneut ausführen, **bevor** du deployst.

> Nicht `pnpm db:seed` gegen Produktion laufen lassen. Dein echter Workspace entsteht über den
> Einrichtungs-Assistenten nach dem ersten Login.

## 4. Hyperdrive anlegen

```bash
pnpm wrangler login
pnpm wrangler hyperdrive create aquisiteur-db \
  --connection-string='postgres://postgres.<ref>:<passwort>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres' \
  --caching-disabled
```

`--caching-disabled`: Das Cockpit soll immer frische Daten sehen. Die Ausgabe enthält eine `id`. Trage sie
in `wrangler.jsonc` bei `hyperdrive[0].id` ein (ersetzt `REPLACE_WITH_HYPERDRIVE_ID`) und committe die
Änderung.

## 5. Resend einrichten

1. In Resend **Domains → Add domain**, Region **EU (Ireland)**, z. B. `mail.aquisiteur.de`.
2. Die angezeigten DNS-Einträge (SPF, DKIM) in Cloudflare DNS anlegen und verifizieren lassen.
3. **API Keys → Create** mit Berechtigung _Sending access_. Den Schlüssel brauchst du in Schritt 6.

## 6. Konfiguration im Worker hinterlegen

Nicht-geheime Werte trägst du in `wrangler.jsonc` unter `vars` ein:

```jsonc
"vars": {
  "HOSTING_PROFILE": "cloudflare",
  "APP_URL": "https://app.aquisiteur.de",
  "PLATFORM_DOMAIN": "aquisiteur.de",
  "EMAIL_PROVIDER": "resend",
  "EMAIL_FROM": "Aquisiteur <anmeldung@mail.aquisiteur.de>",
  "SIGNUP_ALLOWLIST": "deine@adresse.de"
}
```

Geheimnisse setzt du als Secrets (werden verschlüsselt bei Cloudflare gespeichert):

```bash
openssl rand -base64 48 | pnpm wrangler secret put BETTER_AUTH_SECRET
openssl rand -base64 32 | pnpm wrangler secret put INTEGRATIONS_ENCRYPTION_KEY
pnpm wrangler secret put RESEND_API_KEY        # Wert aus Schritt 5 einfügen
```

`INTEGRATIONS_ENCRYPTION_KEY` gut sichern (Passwortmanager): Ohne ihn lassen sich später gespeicherte
Zugangsdaten (z. B. für Pingen) nicht mehr entschlüsseln.

## 7. Domains an den Worker hängen

In `wrangler.jsonc` ergänzen:

```jsonc
"routes": [
  { "pattern": "app.aquisiteur.de", "custom_domain": true },
  { "pattern": "*.aquisiteur.de/*", "zone_name": "aquisiteur.de" }
]
```

Für die Workspace-Adressen (`<workspace>.aquisiteur.de`) zusätzlich in Cloudflare **DNS** einen
Wildcard-Eintrag anlegen: Typ `AAAA`, Name `*`, Inhalt `100::`, **Proxy aktiv** (orange Wolke). Das
Cockpit unter `app.` legt Cloudflare über `custom_domain` selbst an.

## 8. Bauen und deployen

```bash
pnpm cf:deploy
```

Das baut die App mit OpenNext und lädt sie als Worker hoch. Danach `https://app.aquisiteur.de` öffnen:

1. E-Mail-Adresse aus `SIGNUP_ALLOWLIST` eingeben, Anmeldelink aus dem Postfach öffnen.
2. Einrichtungs-Assistent durchlaufen (Workspace, Profil & Kanäle, Absender & Domain).
3. Im letzten Schritt **Passkey anlegen**. Ab dann reicht Fingerabdruck oder Face ID.

## Ohne E-Mail-Versand testen (vor Schritt 5)

Resend ist für einen ersten Test nicht nötig. Die Anmeldung läuft über Better Auth in der eigenen
Datenbank, nicht über Supabase Auth; ein Nutzer, den du im Supabase-Dashboard anlegst, hilft deshalb
nicht. Stattdessen schreibt der Log-Modus den Anmeldelink ins Worker-Log:

1. In `vars`: `"EMAIL_PROVIDER": "log"` und `"ALLOW_LOG_EMAIL": "1"`, deine Adresse in `SIGNUP_ALLOWLIST`.
   `RESEND_API_KEY` weglassen.
2. `pnpm cf:deploy`, in einem zweiten Terminal `pnpm wrangler tail`.
3. Im Cockpit deine Adresse eingeben; der Link erscheint im `tail`-Fenster. Öffnen, Assistent
   durchlaufen, Passkey anlegen.
4. Ab dann meldest du dich per Passkey an. Vor dem echten Betrieb auf Resend umstellen und
   `ALLOW_LOG_EMAIL` entfernen, denn jeder mit Zugriff auf die Logs könnte sonst Anmeldelinks lesen.

Lokal (`pnpm dev`) ist das der Standard: Der Link steht im Terminal, `pnpm db:seed` legt zusätzlich
einen Test-Workspace für `SEED_OWNER_EMAIL` an.

## Updates einspielen

```bash
git pull
pnpm install
DATABASE_URL='<supabase-session-pooler-url>' pnpm db:migrate
pnpm cf:deploy
```

Immer erst migrieren, dann deployen. Migrationen sind so geschrieben, dass die alte App-Version mit dem
neuen Schema weiterläuft.

## Lokal testen wie in Produktion

```bash
cp .env.example .dev.vars        # Werte anpassen, APP_URL=http://localhost:8787
pnpm cf:build && pnpm wrangler dev --port 8787
```

`wrangler dev` nutzt für Hyperdrive die `localConnectionString` aus `wrangler.jsonc` (lokales Postgres).

## Fehlerbehebung

| Symptom                                    | Ursache und Lösung                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration` im Log | Eine Variable aus Schritt 6 fehlt. `pnpm wrangler tail` zeigt, welche.                                                                      |
| Login-Mail kommt nicht                     | `EMAIL_PROVIDER` steht noch auf `log`, oder die Absender-Domain ist in Resend nicht verifiziert. Adresse muss in `SIGNUP_ALLOWLIST` stehen. |
| Passkey-Fehler „origin“                    | `APP_URL` muss exakt der Adresse im Browser entsprechen (https, ohne Schrägstrich am Ende).                                                 |
| `permission denied for table …`            | Migrationen fehlen. Schritt 3 erneut ausführen.                                                                                             |
| Workspace-Adresse liefert 404              | Wildcard-DNS (Schritt 7) fehlt oder der Assistent wurde nicht abgeschlossen.                                                                |

Live-Logs: `pnpm wrangler tail`.

## Kosten (Stand Oktober 2026, ungefähr)

| Dienst                  | Kosten                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Cloudflare Workers Paid | 5 $/Monat inkl. 10 Mio. Anfragen                                                    |
| Hyperdrive              | im Workers-Paid-Plan enthalten                                                      |
| Supabase                | Free-Tarif reicht zum Start; Pro 25 $/Monat für tägliche Backups und kein Pausieren |
| Resend                  | Free bis 3.000 Mails/Monat                                                          |

Hinweis: Supabase pausiert Free-Projekte nach einer Woche ohne Aktivität. Für den echten Betrieb ist
der Pro-Tarif sinnvoll (Backups, kein Pausieren).

## Umzug zu einem anderen Hoster

Siehe [HOSTING.md](./HOSTING.md). Kurzfassung: `HOSTING_PROFILE=node`, `DATABASE_URL` setzen, `pnpm build && pnpm start`.
