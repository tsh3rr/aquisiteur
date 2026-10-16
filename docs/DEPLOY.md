# Deployment: eigener Server (Hetzner + Coolify)

Schritt-für-Schritt-Anleitung, um Aquisiteur auf einem eigenen Server zu betreiben (ADR-0047). Coolify
ist eine Weboberfläche auf dem Server: Sie verbindet das GitHub-Repo, baut jeden Push selbst, holt
TLS-Zertifikate und verwaltet die Datenbank samt Backups. Ein Server reicht für mehrere Prototypen.
Zeitaufwand beim ersten Mal: etwa eine Stunde.

Die frühere Variante mit Cloudflare Workers und Supabase steht in
[DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md).

## Überblick

```
GitHub (main) ──► Coolify auf dem Server: bauen (Nixpacks) → migrieren → starten
                                                                  │
Browser ──► Traefik (TLS, Let's Encrypt) ──► Aquisiteur (Node, Port 3000)
                                                  │            │
                                                  ▼            ▼
                                        Postgres 16 (Coolify)  Cloudflare R2 (Bilder, Aufzeichnungen)
                                                  │
                                                  └── tägliches Backup ──► R2
```

| Was       | Wo                                  | Wofür                                      |
| --------- | ----------------------------------- | ------------------------------------------ |
| Server    | Hetzner Cloud, Standort Deutschland | App und Datenbank                          |
| App       | Coolify-Anwendung aus GitHub        | Cockpit, Exposés, Kurzlinks, Live-Chat     |
| Datenbank | Postgres 16 als Coolify-Ressource   | Alle Daten inkl. Logins (Better Auth)      |
| Dateien   | Cloudflare R2 (Region EU)           | Bilder, Videos, Aufzeichnungen; DB-Backups |
| E-Mail    | Resend (EU-Region)                  | Anmeldelinks und Benachrichtigungen        |

## Voraussetzungen

- Ein Hetzner-Cloud-Konto und eine Domain, deren DNS du bearbeiten kannst
- Ein Cloudflare-Konto (nur für R2; der Free-Plan reicht)
- Ein Resend-Konto (kostenloser Plan reicht für den Anfang)
- Zugriff auf das GitHub-Repo `tsh3rr/aquisiteur`; betrieben wird der Stand auf `main`
- Ein SSH-Schlüssel auf deinem Rechner (`ssh-keygen -t ed25519`, falls noch keiner existiert)
- Ein Passwortmanager für die Schlüssel, die du unterwegs bekommst

## 1. Domains festlegen

Beispiel mit `aquisiteur.de`, ersetze durch deine Domain:

| Zweck                           | Beispiel                                                           | Variable                            |
| ------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| Cockpit                         | `app.aquisiteur.de`                                                | `APP_URL=https://app.aquisiteur.de` |
| Plattform-Domain für Workspaces | `aquisiteur.de` → Workspace-Adressen wie `pixelwerk.aquisiteur.de` | `PLATFORM_DOMAIN=aquisiteur.de`     |
| Coolify selbst                  | `coolify.aquisiteur.de`                                            | (nur in Coolify)                    |

## 2. Server anlegen und absichern

1. In der Hetzner Cloud Console **Add Server**: Standort **Nürnberg** oder **Falkenstein**, Image
   **Ubuntu 24.04**, Typ **CX22** (2 vCPU, 4 GB RAM) oder größer. Unter **SSH keys** deinen öffentlichen
   Schlüssel hinterlegen. **Backups** anhaken (etwa 20 % Aufpreis, tägliche Server-Abbilder).
2. Unter **Firewalls** eine Firewall anlegen und dem Server zuweisen: eingehend nur TCP **22**, **80**,
   **443**. Port 8000 (Coolify vor dem Domain-Setup) nur vorübergehend und nur für deine eigene IP.
3. Per SSH anmelden (`ssh root@<server-ip>`) und die Grundabsicherung einschalten:

   ```bash
   apt update && apt -y upgrade
   apt -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
   # Anmeldung nur noch per Schlüssel
   sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```

## 3. Coolify installieren

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Danach `http://<server-ip>:8000` öffnen, Admin-Konto anlegen. Unter **Settings** die Instanz-Domain
`https://coolify.aquisiteur.de` eintragen (DNS-Eintrag aus Schritt 4 zuerst). Danach Port 8000 in der
Hetzner-Firewall wieder schließen.

## 4. DNS-Einträge

Bei deinem DNS-Anbieter (auch Cloudflare-DNS geht) A-Einträge auf die Server-IP (und AAAA auf die IPv6):

| Name                  | Typ      | Ziel      |
| --------------------- | -------- | --------- |
| `app`                 | A / AAAA | Server-IP |
| `coolify`             | A / AAAA | Server-IP |
| `*` (alle Workspaces) | A / AAAA | Server-IP |

Bei Cloudflare-DNS die Einträge auf **DNS only** (graue Wolke) stellen, damit Coolify die Zertifikate
selbst holen kann. Mit oranger Wolke (Proxy) zeigt die Timeline zusätzlich die Stadt eines Besuchs
(**Rules → Managed Transforms → Add visitor location headers**); dann SSL/TLS auf **Full (strict)**
stellen.

## 5. R2 und Resend anlegen

**R2 (Dateien und Backups):**

1. Im Cloudflare-Dashboard **R2 Object Storage → Create bucket**: `aquisiteur-assets`, Location **EU**.
   Einen zweiten Bucket `aquisiteur-backups` (EU) für die Datenbank-Backups.
2. **R2 → Manage API tokens → Create API token** mit _Object Read & Write_ für beide Buckets. Notiere
   _Access Key ID_, _Secret Access Key_ und den Endpoint `https://<account-id>.eu.r2.cloudflarestorage.com`.

Die Buckets bleiben privat; die App liefert Dateien selbst aus, nur für den passenden Workspace.

**Resend (E-Mail):**

1. **Domains → Add domain**, Region **EU (Ireland)**, z. B. `mail.aquisiteur.de`; die DNS-Einträge (SPF,
   DKIM) anlegen und verifizieren lassen.
2. **API Keys → Create** mit _Sending access_.

Zum ersten Ausprobieren geht es auch ohne Resend, siehe „Ohne E-Mail-Versand testen“.

## 6. Datenbank in Coolify

1. In Coolify **Projects → New** `aquisiteur`, darin **New resource → Database → PostgreSQL 16**.
2. Name `aquisiteur-db`, **Start**. Coolify erzeugt Benutzer und Passwort. Die **interne URL**
   (`postgres://postgres:…@aquisiteur-db:5432/postgres`, nur im Server-Netz erreichbar) ist die
   **Datenbank-URL** für Schritt 8. Die Datenbank bleibt von außen unerreichbar („Make it publicly
   available“ aus lassen).
3. **Backups**: unter **S3 Storages** (in den Coolify-Einstellungen) den Bucket `aquisiteur-backups` mit
   den R2-Zugangsdaten anlegen, dann in der Datenbank **Backups → Scheduled backup**: täglich
   (`0 3 * * *`), **Save to S3** an, Aufbewahrung z. B. 14 Tage. Einmal **Backup now** und prüfen, dass
   die Datei im Bucket liegt.

Die Tabellen legst du nicht von Hand an: Das erledigt jeder Start der App (Schritt 7).

## 7. App aus GitHub anlegen

1. Im Projekt **New resource → Application → Private repository (with GitHub App)**. Coolify führt durch
   die Installation seiner GitHub-App; Zugriff nur auf `tsh3rr/aquisiteur` geben.
2. Branch `main`, Build Pack **Nixpacks**. Die Datei `nixpacks.toml` im Repo legt Node 22, den Build
   (`pnpm build`) und den Start fest: erst `pnpm db:migrate`, dann `pnpm start`.
3. **Ports Exposes**: `3000`.
4. **Domains**: `https://app.aquisiteur.de,https://pixelwerk.aquisiteur.de` (Cockpit plus die Adresse
   jedes Workspaces, kommagetrennt; nach dem Einrichtungs-Assistenten ergänzen). Coolify holt für jede
   ein Zertifikat.
5. **Health check**: Pfad `/healthz`, Port 3000 (antwortet erst, wenn die Datenbank erreichbar ist). So geht eine neue Version erst live, wenn sie antwortet.
6. **Auto deploy** an: jeder Push auf `main` baut und veröffentlicht neu.

Die App läuft als **eine** Instanz. Live-Chat und Live-Feed laufen dann direkt aus dem Node-Prozess
(Server-Sent Events, `REALTIME_PROVIDER=memory`), ohne weiteren Dienst.

## 8. Umgebungsvariablen

Im Projekt `aquisiteur` unter **Environment Variables** (Secrets mit „Is secret?“ markieren).
Die Geheimnisse erzeugt `pnpm deploy:secrets` lokal (`BETTER_AUTH_SECRET`,
`INTEGRATIONS_ENCRYPTION_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`); alles in den
Passwortmanager. `INTEGRATIONS_ENCRYPTION_KEY` besonders gut sichern.

| Name                          | Wert                                               | Secret |
| ----------------------------- | -------------------------------------------------- | ------ |
| `HOSTING_PROFILE`             | `node`                                             |        |
| `HOSTING_PLAN`                | `vps`                                              |        |
| `DATABASE_URL`                | interne Datenbank-URL aus Schritt 6                | ja     |
| `APP_URL`                     | `https://app.aquisiteur.de`                        |        |
| `PLATFORM_DOMAIN`             | `aquisiteur.de`                                    |        |
| `SIGNUP_ALLOWLIST`            | deine E-Mail-Adresse                               |        |
| `PLATFORM_ADMIN_EMAILS`       | deine E-Mail-Adresse (Einstellungen → System)      |        |
| `EMAIL_PROVIDER`              | `resend`                                           |        |
| `EMAIL_FROM`                  | `Aquisiteur <anmeldung@mail.aquisiteur.de>`        |        |
| `RESEND_API_KEY`              | aus Schritt 5                                      | ja     |
| `STORAGE_PROVIDER`            | `s3`                                               |        |
| `S3_ENDPOINT`                 | `https://<account-id>.eu.r2.cloudflarestorage.com` |        |
| `S3_BUCKET`                   | `aquisiteur-assets`                                |        |
| `S3_ACCESS_KEY_ID`            | aus Schritt 5                                      | ja     |
| `S3_SECRET_ACCESS_KEY`        | aus Schritt 5                                      | ja     |
| `REALTIME_PROVIDER`           | `memory`                                           |        |
| `PUSH_PROVIDER`               | `webpush`                                          |        |
| `VAPID_PUBLIC_KEY`            | aus `pnpm deploy:secrets`                          |        |
| `VAPID_PRIVATE_KEY`           | aus `pnpm deploy:secrets`                          | ja     |
| `VAPID_SUBJECT`               | `mailto:deine@adresse.de`                          |        |
| `BETTER_AUTH_SECRET`          | aus `pnpm deploy:secrets`                          | ja     |
| `INTEGRATIONS_ENCRYPTION_KEY` | aus `pnpm deploy:secrets`                          | ja     |
| `CRON_SECRET`                 | aus `pnpm deploy:secrets`                          | ja     |
| `GEOCODER_CONTACT`            | deine E-Mail-Adresse (für die Karte, Nominatim)    |        |
| `SENTRY_DSN`                  | optional, Sentry-Projekt in der Region EU          | ja     |

Dann **Deploy**. Der erste Build dauert einige Minuten (**Deployments → Logs**).

**Fehler-Monitoring (optional, ADR-0044):** Sentry-Projekt in einer Organisation mit Datenregion EU
anlegen, DSN (`https://<key>@o<nr>.ingest.de.sentry.io/<projekt>`) als `SENTRY_DSN`. Ohne DSN landen
Fehler im Log der App in Coolify.

## 9. Stündlicher Job

Tageszusammenfassung, automatische Löschung nach Fristen und die Karte brauchen einen stündlichen
Aufruf (ADR-0032, ADR-0043). In der App **Scheduled Tasks → Add**:

| Feld      | Wert               |
| --------- | ------------------ |
| Name      | `hourly`           |
| Command   | `pnpm jobs:hourly` |
| Frequency | `5 * * * *`        |

Der Befehl läuft im Container der App und ruft `/api/jobs/hourly` mit `CRON_SECRET` auf. Unter
**Scheduled Tasks → Executions** siehst du die Antwort (`200 {"digests":…}`).

## 10. Erster Login

`https://app.aquisiteur.de` öffnen:

1. E-Mail-Adresse aus `SIGNUP_ALLOWLIST` eingeben, Anmeldelink aus dem Postfach öffnen.
2. Einrichtungs-Assistent durchlaufen (Workspace, Profil & Kanäle, Absender & Domain).
3. Im letzten Schritt **Passkey anlegen**. Ab dann reicht Fingerabdruck oder Face ID.
4. Die Workspace-Adresse (z. B. `pixelwerk.aquisiteur.de`) in Coolify unter **Domains** ergänzen
   (Schritt 7.4) und neu deployen.
5. Auf dem Handy: Cockpit öffnen, **Einstellungen → Benachrichtigungen → Push auf diesem Gerät
   aktivieren**, dann **Test senden**. Auf dem iPhone vorher in Safari „Teilen → Zum Home-Bildschirm“.
6. Unter **Einstellungen → Eigene Besuche** auf jedem eigenen Gerät „Dieses Gerät als meines markieren“.
7. Unter **Einstellungen → Impressum und Datenschutz** die Texte prüfen.

## 11. Erstes Exposé veröffentlichen

1. Im Cockpit **Einstellungen → API-Tokens** einen Token anlegen und kopieren.
2. Auf deinem Rechner im Repo:

   ```bash
   export AQUISITEUR_API_TOKEN=aq_…
   export AQUISITEUR_API_URL=https://app.aquisiteur.de
   pnpm expose:publish exposes/cafe-mueller
   ```

3. Die Ausgabe nennt den öffentlichen Link, den Kurzlink für den Brief und den QR-Link. QR-Codes als SVG
   oder PNG gibt es im Cockpit unter **Kunden → Kunde → Links und QR-Codes**.

## Ohne E-Mail-Versand testen

In Schritt 8 `EMAIL_PROVIDER=log` und zusätzlich `ALLOW_LOG_EMAIL=1` setzen; der Anmeldelink erscheint
dann im Log der App (**Logs** in Coolify). Vor dem echten Betrieb auf `resend` umstellen und
`ALLOW_LOG_EMAIL` löschen, sonst kann jeder mit Zugriff auf die Logs Anmeldelinks lesen.

Oder im **Terminal** der App in Coolify (legt den Account an, Link 30 Minuten gültig, einmalig):

```bash
pnpm user:login deine@adresse.de --name "Vorname Nachname"
```

## Updates einspielen

Nichts zu tun: Sobald ein Pull Request auf `main` gemergt ist, baut Coolify die App, startet sie, spielt
dabei die Migrationen ein und schaltet erst um, wenn der Health Check antwortet. Schlägt der Build fehl,
bleibt die vorige Version online. Zurück auf eine frühere Version: **Deployments → Redeploy** bei einem
älteren Commit (Datenbank-Änderungen bleiben dabei bestehen; Migrationen halten die alte Version
lauffähig).

## Wiederherstellen

- **Datenbank:** in Coolify **Backups → Restore**, oder eine Backup-Datei aus R2 mit
  `pg_restore --no-owner -d "$DATABASE_URL" backup.dump` einspielen, danach `pnpm db:migrate`.
- **Ganzer Server:** Hetzner-Backup des Servers wiederherstellen.
- **Dateien** liegen in R2 und sind vom Server unabhängig.

## Überwachung

- **Erreichbarkeit:** ein kostenloser Monitor (z. B. UptimeRobot) auf `https://app.aquisiteur.de/healthz`.
- **Fehler:** Sentry (optional, siehe Schritt 8) oder die Logs in Coolify.
- **Platz und Limits:** Einstellungen → System zeigt Datenbankgröße und Dateispeicher (nur für
  `PLATFORM_ADMIN_EMAILS`). Plattenplatz des Servers zeigt Coolify unter **Servers**.

## Fehlerbehebung

| Symptom                                    | Ursache und Lösung                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Start bricht mit `DATABASE_URL` ab         | Variable fehlt oder zeigt nicht auf die interne URL aus Schritt 6.                                                              |
| `Invalid environment configuration` im Log | Eine Variable aus Schritt 8 fehlt; das Log nennt, welche.                                                                       |
| Zertifikat fehlt / Browser warnt           | DNS-Eintrag zeigt nicht auf den Server, Port 80 ist zu, oder bei Cloudflare-DNS ist der Proxy an, ohne SSL „Full (strict)“.     |
| Workspace-Adresse liefert 404              | Domain in Coolify nicht eingetragen (Schritt 7.4), oder der Assistent wurde nicht abgeschlossen.                                |
| Login-Mail kommt nicht                     | `EMAIL_PROVIDER` steht auf `log`, oder die Absender-Domain ist in Resend nicht verifiziert; Adresse muss in `SIGNUP_ALLOWLIST`. |
| Passkey-Fehler „origin“                    | `APP_URL` muss exakt der Adresse im Browser entsprechen (https, ohne Schrägstrich am Ende).                                     |
| Live-Chat hängt                            | Mehr als eine Instanz läuft; im Node-Profil genau eine Instanz betreiben.                                                       |

## Kosten (Stand Oktober 2026, ungefähr)

| Dienst                     | Kosten                                         |
| -------------------------- | ---------------------------------------------- |
| Hetzner CX22 inkl. Backups | etwa 5–6 €/Monat, für alle Prototypen zusammen |
| Coolify (selbst betrieben) | kostenlos                                      |
| Cloudflare R2              | kostenlos bis 10 GB                            |
| Resend                     | kostenlos bis 3.000 Mails/Monat                |
| Sentry                     | kostenloser Developer-Plan                     |

## Umzug zu einem anderen Hoster

Siehe [HOSTING.md](./HOSTING.md) und [DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md).
