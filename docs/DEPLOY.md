# Deployment: Cloudflare Workers + Supabase

Schritt-für-Schritt-Anleitung, um Aquisiteur produktiv zu betreiben. Stand: Phase 1 (Exposé-Hosting).
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
| Dateien       | Cloudflare R2 (Region EU)      | Bilder und Videos der Exposés                             |

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

## 5b. R2-Bucket für Bilder anlegen

1. Im Cloudflare-Dashboard **R2 → Create bucket**, Name `aquisiteur-assets`, Location **EU**
   (Jurisdiction „European Union“).
2. **R2 → Manage API tokens → Create API token** mit _Object Read & Write_, nur für diesen Bucket.
   Notiere _Access Key ID_, _Secret Access Key_ und den S3-Endpoint
   (`https://<account-id>.eu.r2.cloudflarestorage.com`).

Der Bucket bleibt privat. Die App liefert die Dateien selbst aus, nur für den passenden Workspace.

## 5c. Supabase Realtime für den Chat

Der Live-Chat braucht auf Cloudflare Supabase Realtime (ADR-0020); ohne bricht die App beim Start ab.

1. Im Supabase-Projekt **Project Settings → API Keys**: _Publishable key_ (`sb_publishable_…`) und
   _Secret key_ (`sb_secret_…`) notieren. Die Projekt-URL steht unter **Data API**.
2. **Realtime → Settings**: „Allow public access“ muss an sein (Standard). Die App nutzt öffentliche
   Broadcast-Kanäle mit nicht erratbaren Namen, keine Datenbank-Änderungen über Realtime.

## 5d. Push-Benachrichtigungen und stündlicher Job

Für Push aufs Handy braucht der Worker ein VAPID-Schlüsselpaar, für die Tageszusammenfassung ein
Geheimnis für den stündlichen Job:

```bash
pnpm push:keys                                  # gibt VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY aus
pnpm wrangler secret put VAPID_PRIVATE_KEY      # privaten Schlüssel einfügen
openssl rand -base64 32 | pnpm wrangler secret put CRON_SECRET
```

`VAPID_PUBLIC_KEY`, `PUSH_PROVIDER` und `VAPID_SUBJECT` kommen in Schritt 6 zu den `vars`. Den
Cron-Trigger (`"triggers": { "crons": ["5 * * * *"] }`) bringt `wrangler.jsonc` schon mit; er ruft
stündlich `/api/jobs/hourly` auf (ADR-0032). Ohne `CRON_SECRET` antwortet die Route mit 401 und es
gibt keine Tageszusammenfassung, sonst funktioniert alles.

## 6. Konfiguration im Worker hinterlegen

Nicht-geheime Werte trägst du in `wrangler.jsonc` unter `vars` ein:

```jsonc
"vars": {
  "HOSTING_PROFILE": "cloudflare",
  "APP_URL": "https://app.aquisiteur.de",
  "PLATFORM_DOMAIN": "aquisiteur.de",
  "EMAIL_PROVIDER": "resend",
  "EMAIL_FROM": "Aquisiteur <anmeldung@mail.aquisiteur.de>",
  "SIGNUP_ALLOWLIST": "deine@adresse.de",
  "STORAGE_PROVIDER": "s3",
  "S3_ENDPOINT": "https://<account-id>.eu.r2.cloudflarestorage.com",
  "S3_BUCKET": "aquisiteur-assets",
  "REALTIME_PROVIDER": "supabase",
  "SUPABASE_URL": "https://<projekt>.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_…",
  "PUSH_PROVIDER": "webpush",
  "VAPID_PUBLIC_KEY": "B…",
  "VAPID_SUBJECT": "mailto:deine@adresse.de"
}
```

Geheimnisse setzt du als Secrets (werden verschlüsselt bei Cloudflare gespeichert):

```bash
openssl rand -base64 48 | pnpm wrangler secret put BETTER_AUTH_SECRET
openssl rand -base64 32 | pnpm wrangler secret put INTEGRATIONS_ENCRYPTION_KEY
pnpm wrangler secret put RESEND_API_KEY        # Wert aus Schritt 5 einfügen
pnpm wrangler secret put S3_ACCESS_KEY_ID      # Werte aus Schritt 5b
pnpm wrangler secret put S3_SECRET_ACCESS_KEY
pnpm wrangler secret put SUPABASE_SECRET_KEY   # Wert aus Schritt 5c
pnpm wrangler secret put VAPID_PRIVATE_KEY     # Wert aus Schritt 5d
pnpm wrangler secret put CRON_SECRET           # Wert aus Schritt 5d
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

### Ort der Besucher (Stadt)

Die Timeline zeigt die Stadt eines Besuchs. Sie kommt aus dem Header `cf-ipcity`, den Cloudflare nur mit
einer Einstellung mitschickt: im Cloudflare-Dashboard unter **Rules → Settings → Managed Transforms**
den Schalter **Add visitor location headers** einschalten. Ohne ihn fehlt nur die Stadt, alles andere
funktioniert. Die IP-Adresse liest Aquisiteur nie.

## 8. Bauen und deployen

```bash
pnpm cf:deploy
```

Das baut die App mit OpenNext und lädt sie als Worker hoch. Danach `https://app.aquisiteur.de` öffnen:

1. E-Mail-Adresse aus `SIGNUP_ALLOWLIST` eingeben, Anmeldelink aus dem Postfach öffnen.
2. Einrichtungs-Assistent durchlaufen (Workspace, Profil & Kanäle, Absender & Domain).
3. Im letzten Schritt **Passkey anlegen**. Ab dann reicht Fingerabdruck oder Face ID.
4. Auf dem Handy: Cockpit öffnen, **Einstellungen → Benachrichtigungen → Push auf diesem Gerät
   aktivieren**, dann **Test senden**. Auf dem iPhone vorher in Safari „Teilen → Zum Home-Bildschirm“
   und Aquisiteur von dort öffnen; Push geht dort nur aus der installierten App.

## 9. Erstes Exposé veröffentlichen

1. Im Cockpit **Einstellungen → API-Tokens** einen Token anlegen und kopieren.
2. Lokal im Repo:

   ```bash
   export AQUISITEUR_API_TOKEN=aq_…
   export AQUISITEUR_API_URL=https://app.aquisiteur.de
   pnpm expose:publish exposes/cafe-mueller
   ```

3. Die CLI gibt den öffentlichen Link, den Kurzlink für den Brief (z. B. `pixelwerk.aquisiteur.de/k7m2`)
   und den QR-Link aus. QR-Codes als SVG oder PNG (300 dpi) gibt es im Cockpit unter **Kunden → Kunde →
   Links und QR-Codes**.
4. Unter **Einstellungen → Eigene Besuche** auf jedem eigenen Gerät „Dieses Gerät als meines markieren“
   antippen, damit eigene Aufrufe nicht als Kundenbesuche zählen.

Wie du eigene Exposés schreibst: [EXPOSE_AUTHORING.md](./EXPOSE_AUTHORING.md).

## Ohne E-Mail-Versand testen (vor Schritt 5)

Resend ist für einen ersten Test nicht nötig. Die Anmeldung läuft über Better Auth in der eigenen
Datenbank, nicht über Supabase Auth; ein Nutzer, den du im Supabase-Dashboard anlegst, hilft deshalb
nicht.

**Am einfachsten: Account und Anmeldelink per Befehl.** Lokal im Repo, mit dem Connection-String aus
Schritt 2 und deiner Cockpit-Adresse:

```bash
DATABASE_URL='<supabase-session-pooler-url>' APP_URL='https://app.aquisiteur.de' \
  pnpm user:login deine@adresse.de --name "Vorname Nachname"
```

Der Befehl legt den Account an (falls noch nicht vorhanden) und gibt einen Anmeldelink aus, der
30 Minuten gilt und nur einmal funktioniert. Link öffnen, Einrichtungs-Assistent durchlaufen, Passkey
anlegen. Ab dann meldest du dich per Passkey an. Wer den Assistenten überspringen will, hängt
`--workspace "Agenturname" --slug agenturname` an; Profil und Kanäle trägst du dann in den
Einstellungen nach. Der Befehl funktioniert jederzeit erneut, z. B. wenn du den Passkey verlierst.

**Alternative: Link im Worker-Log.**

1. In `vars`: `"EMAIL_PROVIDER": "log"` und `"ALLOW_LOG_EMAIL": "1"`, deine Adresse in `SIGNUP_ALLOWLIST`.
   `RESEND_API_KEY` weglassen.
2. `pnpm cf:deploy`, in einem zweiten Terminal `pnpm wrangler tail`.
3. Im Cockpit deine Adresse eingeben; der Link erscheint im `tail`-Fenster.
4. Vor dem echten Betrieb auf Resend umstellen und `ALLOW_LOG_EMAIL` entfernen, denn jeder mit Zugriff
   auf die Logs könnte sonst Anmeldelinks lesen.

Lokal (`pnpm dev`) steht der Link im Terminal. `pnpm db:seed` legt zusätzlich einen fertigen
Test-Workspace mit zwei Beispiel-Exposés für `SEED_OWNER_EMAIL` an (nur lokal, nicht gegen Produktion).

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
