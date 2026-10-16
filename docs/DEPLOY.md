# Deployment: Cloudflare Workers + Supabase

Schritt-für-Schritt-Anleitung, um Aquisiteur produktiv zu betreiben, **komplett über die
Weboberflächen** von Cloudflare, Supabase, Resend und GitHub. Ein Terminal brauchst du nicht; die
zwei Befehle, die es ohne Klickweg nicht gibt, laufen im Browser (GitHub Codespaces, siehe unten).
Zeitaufwand beim ersten Mal: etwa eine Stunde.

> Kurz gesagt: Supabase liefert die Postgres-Datenbank in Frankfurt, Cloudflare Hyperdrive verbindet
> den Worker schnell mit ihr, Cloudflare Workers führt die Next.js-App aus. Cloudflare baut die App bei
> jedem Push auf `main` selbst aus GitHub, spielt dabei die Datenbank-Migrationen ein und
> veröffentlicht sie (Workers Builds, ADR-0036).

## Überblick

```
GitHub (main) ──► Cloudflare Workers Builds: bauen → migrieren → deployen
                                                         │
Browser ──► Cloudflare Worker (Next.js via OpenNext) ◄───┘
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
| App           | Cloudflare Workers             | Cockpit, Exposés, Kurzlinks                               |
| DB-Verbindung | Cloudflare Hyperdrive          | Pooling, damit der Worker nicht pro Anfrage neu verbindet |
| E-Mail        | Resend (EU-Region)             | Anmeldelinks und Benachrichtigungen                       |
| Dateien       | Cloudflare R2 (Region EU)      | Bilder und Videos der Exposés                             |

## Voraussetzungen

- Ein Cloudflare-Konto mit deiner Domain als Zone in Cloudflare; zum Testen reicht der Free-Plan, für
  den Betrieb **Workers Paid** (5 $/Monat, siehe Kosten)
- Ein Supabase-Konto
- Ein Resend-Konto (kostenloser Plan reicht für den Anfang)
- Zugriff auf das GitHub-Repo `tsh3rr/aquisiteur`; der Stand, den du betreiben willst, liegt auf `main`
  (Pull Request vorher mergen)
- Ein Passwortmanager für die Schlüssel, die du unterwegs bekommst

### Befehle im Browser: GitHub Codespaces

An zwei Stellen (Schlüssel erzeugen, Exposé veröffentlichen) brauchst du einen Befehl. Dafür öffnest
du im Repo auf GitHub **Code → Codespaces → Create codespace on main**. Nach einer Minute hast du VS
Code mit Terminal im Browser. Darin einmalig:

```bash
corepack enable && pnpm install
```

Für Privatkonten ist Codespaces bis 120 Kernstunden im Monat kostenlos; den Codespace danach unter
**github.com/codespaces** stoppen oder löschen.

## 1. Domains festlegen

Du brauchst zwei Dinge (Beispiel mit `aquisiteur.de`, ersetze durch deine Domain):

| Zweck                           | Beispiel                                                           | Variable                            |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Cockpit                         | `app.aquisiteur.de`                                                | `APP_URL=https://app.aquisiteur.de` |
| Plattform-Domain für Workspaces | `aquisiteur.de` → Workspace-Adressen wie `pixelwerk.aquisiteur.de` | `PLATFORM_DOMAIN=aquisiteur.de`     |

Später kann jeder Workspace zusätzlich eine eigene Domain bekommen (z. B. `go.pixelwerk.de`).

## 2. Supabase-Datenbank anlegen

1. Auf [supabase.com](https://supabase.com) → **New project**.
2. Name: `aquisiteur`, **Region: Central EU (Frankfurt)**, ein starkes Datenbank-Passwort erzeugen und im
   Passwortmanager speichern.
3. Nach dem Anlegen: **Project Settings → Data API** → bei _Exposed schemas_ `public` entfernen (oder die
   Data API ganz deaktivieren). Aquisiteur spricht nur direkt per Postgres mit der Datenbank; die
   REST-API von Supabase wird nicht gebraucht. Alle Tabellen haben zusätzlich Row Level Security.
4. **Connect** (oben im Projekt) → **Connection string** → **Session pooler** kopieren und dein Passwort
   einsetzen. Er sieht so aus:

   ```
   postgres://postgres.<project-ref>:<DEIN-PASSWORT>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```

   Den Session Pooler (Port **5432**) nutzen, nicht den Transaction Pooler (Port 6543): Aquisiteur setzt
   pro Transaktion eine Datenbankrolle und Variablen für die Mandantentrennung. Diesen String nennt die
   Anleitung ab hier **Datenbank-URL**.

5. Für den Live-Chat (Supabase Realtime, ADR-0020): unter **Project Settings → API Keys** den
   _Publishable key_ (`sb_publishable_…`) und den _Secret key_ (`sb_secret_…`) notieren, unter **Data
   API** die Projekt-URL (`https://<projekt>.supabase.co`). Unter **Realtime → Settings** muss „Allow
   public access“ an sein (Standard). Die App nutzt nur Broadcast-Kanäle mit nicht erratbaren Namen.

Die Tabellen legst du nicht von Hand an: Das erledigt jeder Deploy (Schritt 6).

## 3. Hyperdrive anlegen

1. Im Cloudflare-Dashboard **Storage & Databases → Hyperdrive → Create configuration**.
2. Name `aquisiteur-db`, als Verbindung die Datenbank-URL aus Schritt 2 (oder die Felder einzeln: Host
   `aws-0-eu-central-1.pooler.supabase.com`, Port `5432`, Datenbank `postgres`, Benutzer
   `postgres.<project-ref>`, dein Passwort).
3. **Caching ausschalten** (beim Anlegen oder danach in den Einstellungen der Konfiguration): Das
   Cockpit soll immer frische Daten sehen.
4. Die **ID** der Konfiguration kopieren (32 Zeichen).
5. Auf GitHub im Repo die Datei `wrangler.jsonc` öffnen, auf den Stift (**Edit**) klicken,
   `REPLACE_WITH_HYPERDRIVE_ID` durch die ID ersetzen und direkt auf `main` committen
   (**Commit changes**). Das ist die einzige Datei, die du anfasst.

## 4. Resend und R2 anlegen

**Resend (E-Mail):**

1. In Resend **Domains → Add domain**, Region **EU (Ireland)**, z. B. `mail.aquisiteur.de`.
2. Die angezeigten DNS-Einträge (SPF, DKIM) in Cloudflare unter **DNS → Records** anlegen und in Resend
   verifizieren lassen.
3. **API Keys → Create** mit Berechtigung _Sending access_, Schlüssel im Passwortmanager speichern.

Zum ersten Ausprobieren geht es auch ohne Resend, siehe „Ohne E-Mail-Versand testen“.

**R2 (Bilder):**

1. Im Cloudflare-Dashboard **R2 Object Storage → Create bucket**, Name `aquisiteur-assets`, Location
   **EU** (Jurisdiction „European Union“).
2. **R2 → Manage API tokens → Create API token** mit _Object Read & Write_, nur für diesen Bucket.
   Notiere _Access Key ID_, _Secret Access Key_ und den S3-Endpoint
   (`https://<account-id>.eu.r2.cloudflarestorage.com`).

Der Bucket bleibt privat. Die App liefert die Dateien selbst aus, nur für den passenden Workspace.

## 5. Schlüssel erzeugen

Aquisiteur braucht ein paar zufällige Geheimnisse und ein Schlüsselpaar für Push aufs Handy. Im
Codespace (siehe Voraussetzungen):

```bash
pnpm deploy:secrets
```

Die Ausgabe enthält `BETTER_AUTH_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`, `CRON_SECRET`,
`VAPID_PUBLIC_KEY` und `VAPID_PRIVATE_KEY`. Alles in den Passwortmanager; es wird nirgends
gespeichert. `INTEGRATIONS_ENCRYPTION_KEY` besonders gut sichern: Ohne ihn lassen sich später
gespeicherte Zugangsdaten (z. B. für Pingen) nicht mehr entschlüsseln.

Ohne Codespace geht es auch: Die drei Geheimnisse kann dein Passwortmanager erzeugen (zufällig, mindestens
40 Zeichen, nur Buchstaben und Ziffern). Nur das Push-Schlüsselpaar braucht den Befehl; ohne es läuft
alles außer Push.

## 6. Worker aus GitHub anlegen (Workers Builds)

1. Im Cloudflare-Dashboard **Workers & Pages → Create → Import a repository** (bzw. „Connect to Git“).
   GitHub verbinden und `tsh3rr/aquisiteur` auswählen.
2. Einstellungen:

   | Feld                         | Wert                                                      |
   | ---------------------------- | --------------------------------------------------------- |
   | Project name                 | `aquisiteur` (muss zum `name` in `wrangler.jsonc` passen) |
   | Production branch            | `main`                                                    |
   | Build command                | `pnpm cf:build`                                           |
   | Deploy command               | `pnpm cf:release`                                         |
   | Non-production branch builds | aus                                                       |

3. Unter **Advanced settings → Build variables** anlegen:

   | Name           | Wert                      | Typ    |
   | -------------- | ------------------------- | ------ |
   | `DATABASE_URL` | Datenbank-URL (Schritt 2) | Secret |
   | `NODE_VERSION` | `22`                      | Text   |

   `pnpm cf:release` spielt mit `DATABASE_URL` zuerst die Migrationen ein und veröffentlicht danach
   die neue Version. So läuft nie neuer Code gegen ein altes Schema.

4. **Deploy**. Der erste Build dauert einige Minuten (Fortschritt unter **Deployments**). Die App
   antwortet danach noch mit Fehlern, weil die Konfiguration fehlt; die kommt im nächsten Schritt.

Ab jetzt baut und veröffentlicht Cloudflare jeden Push auf `main` von selbst.

## 7. Konfiguration im Worker hinterlegen

Im Worker **Settings → Variables and Secrets → Add**. Typ **Text** für normale Werte, **Secret** für
Geheimnisse (werden verschlüsselt gespeichert und sind danach nicht mehr lesbar). Nach dem Speichern
übernimmt Cloudflare die Werte sofort, ohne neuen Build.

**Text:**

| Name                       | Wert                                               |
| -------------------------- | -------------------------------------------------- |
| `APP_URL`                  | `https://app.aquisiteur.de`                        |
| `PLATFORM_DOMAIN`          | `aquisiteur.de`                                    |
| `EMAIL_PROVIDER`           | `resend`                                           |
| `EMAIL_FROM`               | `Aquisiteur <anmeldung@mail.aquisiteur.de>`        |
| `SIGNUP_ALLOWLIST`         | deine E-Mail-Adresse                               |
| `STORAGE_PROVIDER`         | `s3`                                               |
| `S3_ENDPOINT`              | `https://<account-id>.eu.r2.cloudflarestorage.com` |
| `S3_BUCKET`                | `aquisiteur-assets`                                |
| `REALTIME_PROVIDER`        | `supabase`                                         |
| `SUPABASE_URL`             | `https://<projekt>.supabase.co`                    |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`                                 |
| `PUSH_PROVIDER`            | `webpush`                                          |
| `VAPID_PUBLIC_KEY`         | aus Schritt 5                                      |
| `VAPID_SUBJECT`            | `mailto:deine@adresse.de`                          |

**Secret:**

| Name                          | Wert                        |
| ----------------------------- | --------------------------- |
| `BETTER_AUTH_SECRET`          | aus Schritt 5               |
| `INTEGRATIONS_ENCRYPTION_KEY` | aus Schritt 5               |
| `CRON_SECRET`                 | aus Schritt 5               |
| `VAPID_PRIVATE_KEY`           | aus Schritt 5               |
| `RESEND_API_KEY`              | aus Schritt 4               |
| `S3_ACCESS_KEY_ID`            | aus Schritt 4 (R2)          |
| `S3_SECRET_ACCESS_KEY`        | aus Schritt 4 (R2)          |
| `SUPABASE_SECRET_KEY`         | `sb_secret_…` aus Schritt 2 |

`HOSTING_PROFILE` steht schon in `wrangler.jsonc`. Dort steht auch `keep_vars: true`, damit spätere
Deploys deine Werte aus dem Dashboard nicht löschen.

Der stündliche Job (Tageszusammenfassung, ADR-0032) ist ebenfalls schon eingerichtet; er läuft nur mit
`CRON_SECRET`. Ohne es gibt es keine Tageszusammenfassung, sonst funktioniert alles.

## 8. Domains an den Worker hängen

1. Im Worker **Settings → Domains & Routes → Add → Custom domain**: `app.aquisiteur.de`. Cloudflare
   legt DNS-Eintrag und Zertifikat selbst an.
2. **Add → Route**: `*.aquisiteur.de/*`, Zone `aquisiteur.de`.
3. Für die Workspace-Adressen (`<workspace>.aquisiteur.de`) in Cloudflare **DNS → Records → Add
   record**: Typ `AAAA`, Name `*`, IPv6-Adresse `100::`, **Proxy aktiv** (orange Wolke).
4. Damit die Timeline die Stadt eines Besuchs zeigt: **Rules → Settings → Managed Transforms →
   Add visitor location headers** einschalten. Ohne fehlt nur die Stadt. Die IP-Adresse liest
   Aquisiteur nie.

## 9. Erster Login

`https://app.aquisiteur.de` öffnen:

1. E-Mail-Adresse aus `SIGNUP_ALLOWLIST` eingeben, Anmeldelink aus dem Postfach öffnen.
2. Einrichtungs-Assistent durchlaufen (Workspace, Profil & Kanäle, Absender & Domain).
3. Im letzten Schritt **Passkey anlegen**. Ab dann reicht Fingerabdruck oder Face ID.
4. Auf dem Handy: Cockpit öffnen, **Einstellungen → Benachrichtigungen → Push auf diesem Gerät
   aktivieren**, dann **Test senden**. Auf dem iPhone vorher in Safari „Teilen → Zum Home-Bildschirm“
   und Aquisiteur von dort öffnen; Push geht dort nur aus der installierten App.
5. Unter **Einstellungen → Eigene Besuche** auf jedem eigenen Gerät „Dieses Gerät als meines markieren“,
   damit eigene Aufrufe nicht als Kundenbesuche zählen.

## 10. Erstes Exposé veröffentlichen

1. Im Cockpit **Einstellungen → API-Tokens** einen Token anlegen und kopieren.
2. Im Codespace:

   ```bash
   export AQUISITEUR_API_TOKEN=aq_…
   export AQUISITEUR_API_URL=https://app.aquisiteur.de
   pnpm expose:publish exposes/cafe-mueller
   ```

3. Die Ausgabe nennt den öffentlichen Link, den Kurzlink für den Brief (z. B.
   `pixelwerk.aquisiteur.de/k7m2`) und den QR-Link. QR-Codes als SVG oder PNG (300 dpi) gibt es im
   Cockpit unter **Kunden → Kunde → Links und QR-Codes**.

Wie du eigene Exposés schreibst: [EXPOSE_AUTHORING.md](./EXPOSE_AUTHORING.md).

## Ohne E-Mail-Versand testen

Resend ist für einen ersten Test nicht nötig. Die Anmeldung läuft über Better Auth in der eigenen
Datenbank, nicht über Supabase Auth; ein Nutzer, den du im Supabase-Dashboard anlegst, hilft deshalb
nicht.

**Link im Worker-Log (nur Dashboard):**

1. In Schritt 7 `EMAIL_PROVIDER` = `log` setzen, zusätzlich `ALLOW_LOG_EMAIL` = `1` (Text).
   `RESEND_API_KEY` weglassen.
2. Im Worker **Observability → Logs** (bzw. **Logs → Live**) öffnen.
3. Im Cockpit deine Adresse eingeben; der Anmeldelink erscheint im Log.
4. Vor dem echten Betrieb auf `resend` umstellen und `ALLOW_LOG_EMAIL` löschen, denn jeder mit Zugriff
   auf die Logs könnte sonst Anmeldelinks lesen.

**Oder per Befehl im Codespace:** legt den Account an und gibt einen Anmeldelink aus, der 30 Minuten
und nur einmal gilt. Funktioniert jederzeit erneut, z. B. wenn du den Passkey verlierst.

```bash
DATABASE_URL='<Datenbank-URL>' APP_URL='https://app.aquisiteur.de' \
  pnpm user:login deine@adresse.de --name "Vorname Nachname"
```

## Updates einspielen

Nichts zu tun: Sobald ein Pull Request auf `main` gemergt ist, baut Cloudflare die App, spielt die
Migrationen ein und veröffentlicht sie. Den Verlauf siehst du im Worker unter **Deployments**; schlägt
ein Build fehl, bleibt die vorige Version online. Migrationen sind so geschrieben, dass die alte
App-Version mit dem neuen Schema weiterläuft. Zurück auf eine frühere Version: **Deployments →
Version → Rollback** (Datenbank-Änderungen bleiben dabei bestehen).

## Fehlerbehebung

| Symptom                                       | Ursache und Lösung                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Build bricht mit `DATABASE_URL is not set` ab | Build-Variable aus Schritt 6 fehlt: Worker **Settings → Build → Variables and secrets**.                                                        |
| Build: Hyperdrive-ID ungültig                 | `REPLACE_WITH_HYPERDRIVE_ID` in `wrangler.jsonc` steht noch drin oder die ID ist falsch (Schritt 3).                                            |
| `Invalid environment configuration` im Log    | Eine Variable aus Schritt 7 fehlt. Das Log (**Observability → Logs**) nennt, welche.                                                            |
| Login-Mail kommt nicht                        | `EMAIL_PROVIDER` steht noch auf `log`, oder die Absender-Domain ist in Resend nicht verifiziert. Die Adresse muss in `SIGNUP_ALLOWLIST` stehen. |
| Passkey-Fehler „origin“                       | `APP_URL` muss exakt der Adresse im Browser entsprechen (https, ohne Schrägstrich am Ende).                                                     |
| `permission denied for table …`               | Migrationen fehlen. Im Worker unter **Deployments** den letzten Build prüfen oder ihn neu starten (**Retry build**).                            |
| Workspace-Adresse liefert 404                 | Route oder Wildcard-DNS aus Schritt 8 fehlt, oder der Assistent wurde nicht abgeschlossen.                                                      |
| Werte aus dem Dashboard nach Deploy weg       | `keep_vars` fehlt in `wrangler.jsonc`.                                                                                                          |

## Alternativ per Kommandozeile

Wer lieber im Terminal arbeitet: `pnpm wrangler hyperdrive create … --caching-disabled`,
`pnpm wrangler secret put <NAME>`, `DATABASE_URL=… pnpm db:migrate` und `pnpm cf:deploy` ersetzen die
Schritte 3, 6 und 7. Variablen setzt du dann im Dashboard oder unter `vars` in `wrangler.jsonc`.

Lokal wie in Produktion testen:

```bash
cp .env.example .dev.vars        # Werte anpassen, APP_URL=http://localhost:8787
pnpm cf:build && pnpm wrangler dev --port 8787
```

`wrangler dev` nutzt für Hyperdrive die `localConnectionString` aus `wrangler.jsonc` (lokales Postgres).

## Kosten (Stand Oktober 2026, ungefähr)

| Dienst                  | Kosten                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Cloudflare Workers Paid | 5 $/Monat inkl. 10 Mio. Anfragen                                                    |
| Hyperdrive              | im Workers-Paid-Plan enthalten                                                      |
| Workers Builds          | im Free-Plan 3.000 Build-Minuten/Monat, reicht weit                                 |
| Supabase                | Free-Tarif reicht zum Start; Pro 25 $/Monat für tägliche Backups und kein Pausieren |
| Resend                  | Free bis 3.000 Mails/Monat                                                          |

**Ohne Workers Paid starten:** Der Worker passt mit 2,6 MB in die 3-MB-Grenze des Free-Plans
(ADR-0035), und Hyperdrive gibt es dort ebenfalls (mit kleineren Kontingenten). Zum Ausprobieren reicht
das. Die Grenze von 10 ms CPU pro Anfrage kann bei Exposés, dem Cockpit oder der Anmeldung überschritten
werden; dann bricht die Anfrage mit einem Fehler ab. Sobald echte Briefe rausgehen oder solche Fehler in
den Worker-Logs auftauchen, auf Workers Paid wechseln (im Dashboard unter **Workers & Pages → Plans**,
ohne neues Deployment).

Hinweis: Supabase pausiert Free-Projekte nach einer Woche ohne Aktivität. Für den echten Betrieb ist
der Pro-Tarif sinnvoll (Backups, kein Pausieren).

## Umzug zu einem anderen Hoster

Siehe [HOSTING.md](./HOSTING.md). Kurzfassung: `HOSTING_PROFILE=node`, `DATABASE_URL` setzen, `pnpm build && pnpm start`.
