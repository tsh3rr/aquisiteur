# Deployment: Docker Compose auf Mikrus

So läuft Aquisiteur im Betrieb (ADR-0053, ADR-0054, ADR-0057, ADR-0079): GitHub Actions baut aus dem
`Dockerfile` ein fertiges App-Image und legt es in die GitHub Container Registry
(`ghcr.io/tsh3rr/aquisiteur`). Auf dem Server laufen nur zwei Container per Docker Compose: Postgres und
dieses Image. Zusammen brauchen sie rund 150 MB, gebaut wird auf dem Server nichts. Mikrus macht das
HTTPS und reicht HTTP an Port 80 weiter, ein eigener Proxy ist nicht nötig.

```
Merge auf main ──► GitHub Actions „Image“: Image bauen ──► ghcr.io/tsh3rr/aquisiteur:latest
                                          │
                                          └─► SSH auf den Staging-Server: docker compose pull && up -d
Release (Tag v… oder Run workflow) ──► Image :production ──► SSH auf den Produktions-Server

Browser ──► Mikrus-Proxy (HTTPS) ──► Port 80 ──► App-Container (Node, Port 3000) ──► Postgres 16 (Container)
```

**Node-Version:** steht im `Dockerfile` (`FROM node:<version>-bookworm-slim`). Die CI testet mit
derselben Version (`node-version` in `.github/workflows/ci.yml`), `engines` in `package.json` nennt
sie als Mindestversion. Beim Wechsel alle drei zusammen ändern; der nächste Merge baut das Image neu.

Die Beispiele nutzen `aquisiteur.mikrus.dev` für das Cockpit und `coalform.mikrus.dev` für einen
Workspace. Der SSH-Zugang steht in der Willkommens-Mail von Mikrus (`ssh -p <port> root@<server>`).
Docker und `docker compose` müssen auf dem Server laufen (`docker compose version` antwortet).

## 1. Subdomains bei Mikrus

Im Mikrus-Panel zwei Subdomains auf **Port 80**, Haken „Port źródłowy jest HTTPS“ **aus**:
`aquisiteur.mikrus.dev` (Cockpit) und `coalform.mikrus.dev` (Workspace mit den Exposés). Jeder weitere
Workspace bekommt hier eine eigene Subdomain.

## 2. Image laden dürfen

Das Image `ghcr.io/tsh3rr/aquisiteur` ist privat. Auf GitHub unter **Settings → Developer settings →
Personal access tokens → Tokens (classic)** ein Token nur mit `read:packages` anlegen, dann auf dem
Server:

```bash
docker login ghcr.io -u <github-name>   # Token als Passwort
```

## 3. Dateien auf den Server

Auf deinem Rechner im Repo-Ordner (aktueller Stand von `main`):

```bash
ssh -p <port> root@<server> "mkdir -p /opt/aquisiteur"
scp -P <port> deploy/compose.yml root@<server>:/opt/aquisiteur/compose.yml
scp -P <port> deploy/env.example root@<server>:/opt/aquisiteur/.env
```

## 4. Einstellungen in `.env`

Auf dem Server:

```bash
cd /opt/aquisiteur
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
docker compose run --rm --no-deps app pnpm deploy:secrets | grep = | while IFS== read k v; do sed -i "s|^$k=.*|$k=$v|" .env; done
sed -i 's/you@example.com/deine@adresse.de/g' .env
grep -E '^(BETTER_AUTH|CRON|VAPID|SIGNUP)' .env | cut -c1-30
```

Die zweite Zeile lädt das Image, erzeugt die fünf Geheimnisse und trägt sie in `.env` ein. Die dritte
setzt deine Adresse ein (vorher anpassen): `SIGNUP_ALLOWLIST` und `PLATFORM_ADMIN_EMAILS` müssen die
Adresse sein, mit der du dich in Schritt 6 anmeldest. Die letzte zeigt nur den Anfang der Werte zur
Kontrolle. `APP_URL` und `PLATFORM_DOMAIN` prüfen (`nano .env`; Text aus Windows mit Rechtsklick
einfügen, speichern mit Strg+O, Enter, Strg+X).

Die Datei enthält alle Geheimnisse. Eine Kopie gehört in den Passwortmanager, etwa so geholt (auf deinem
Rechner, nicht in den Repo-Ordner): `scp -P <port> root@<server>:/opt/aquisiteur/.env aquisiteur.env`.

## 5. Starten

```bash
docker compose up -d
docker compose ps        # beide "Up", die App nach etwa einer Minute "(healthy)"
docker compose logs app  # "Migrations applied." und "Ready"
```

`https://aquisiteur.mikrus.dev/healthz` antwortet mit `ok`. Container starten nach einem Neustart des
Servers von selbst.

## 6. Erster Login

```bash
docker compose exec app pnpm user:login deine@adresse.de --name "Vorname Nachname" \
  --workspace "Coalform" --slug coalform
```

Gibt einen Anmeldelink aus (30 Minuten gültig, einmal nutzbar). Der Workspace liegt dann unter
`coalform.mikrus.dev`. Weitere Anmeldelinks stehen im Log (`docker compose logs app | grep -i http`),
solange Mails ins Log gehen (`EMAIL_PROVIDER=log`).

## 7. Exposés veröffentlichen

Auf deinem Rechner im Repo-Ordner, nicht auf dem Server: Die CLI verkleinert die Bilder mit `sharp`,
und dafür reicht 1 GB RAM neben der App nicht (der Vorgang bricht mit Code 143 ab). Den Token legst du
im Cockpit unter **Einstellungen → API-Tokens** an. PowerShell:

```powershell
pnpm.cmd install
$env:AQUISITEUR_API_URL="https://aquisiteur.mikrus.dev"
$env:AQUISITEUR_API_TOKEN="<token>"
foreach ($e in "cafe-mueller","tischlerei-holzmann","eisenwerk-athletics","physio-lindenhof") { pnpm.cmd expose:publish exposes/$e }
```

Das veröffentlicht die vier Beispiel-Exposés in deinem Workspace. Eigene Exposés: `docs/EXPOSE_AUTHORING.md`.

## 8. Stündlicher Job und tägliches Backup

Ohne den stündlichen Job kommen keine Erinnerungen an Aufgaben, keine Wartungsrechnungen, keine Mahnungen und keine Tageszusammenfassung.
`crontab -e` und diese zwei Zeilen anhängen:

```
5 * * * * cd /opt/aquisiteur && docker compose exec -T app pnpm jobs:hourly >> /var/log/aquisiteur-hourly.log 2>&1
0 3 * * * mkdir -p /root/backups && cd /opt/aquisiteur && docker compose exec -T db pg_dump -U aquisiteur -Fc aquisiteur > /root/backups/aquisiteur-$(date +\%F).dump && find /root/backups -name '*.dump' -mtime +14 -delete
```

Ein Backup auf demselben Server schützt nicht vor dessen Verlust. Ab und zu herunterladen
(`scp -P <port> root@<server>:/root/backups/*.dump .`) oder nach R2 sichern („Für den echten Betrieb“).

Zurückspielen: `docker compose exec -T db pg_restore -U aquisiteur -d aquisiteur --clean --if-exists < datei.dump`.

## 9. Updates

Nach jedem Merge auf `main` baut GitHub ein neues Image (Actions → Image). Von Hand geht es auf dem
Server so:

```bash
cd /opt/aquisiteur && docker compose pull app && docker compose up -d
```

Die App spielt beim Start die Migrationen ein.

### Staging: automatisch nach jedem Merge

Mit einem Deploy-Schlüssel loggt sich GitHub nach dem Bauen selbst ein und führt genau diesen Befehl
aus. Werden mehrere Pull Requests kurz nacheinander gemergt, bricht GitHub den laufenden Durchgang ab
und baut nur den neuesten Stand, es entsteht also ein Image und ein Deployment. Einmal einrichten:

1. Auf dem Server einen eigenen Schlüssel erzeugen, der nur das Update ausführen darf (auch wenn er in
   falsche Hände gerät, kann er keine Shell öffnen):

   ```bash
   ssh-keygen -t ed25519 -N "" -C github-deploy -f /root/.ssh/github-deploy
   echo "command=\"cd /opt/aquisiteur && docker compose pull -q app && docker compose up -d && docker image prune -f\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat /root/.ssh/github-deploy.pub)" >> /root/.ssh/authorized_keys
   cat /root/.ssh/github-deploy                 # privater Schlüssel, für DEPLOY_SSH_KEY
   ssh-keyscan -p <port> <server> 2>/dev/null   # Fingerabdruck des Servers, für DEPLOY_KNOWN_HOSTS
   ```

2. Auf GitHub im Repo unter **Settings → Secrets and variables → Actions → New repository secret**
   anlegen (am Handy im Browser, die GitHub-App kann keine Secrets):

   | Name                 | Wert                                                                    |
   | -------------------- | ----------------------------------------------------------------------- |
   | `DEPLOY_SSH_KEY`     | die ganze Ausgabe von `cat`, mit den Zeilen `-----BEGIN` und `-----END` |
   | `DEPLOY_HOST`        | `<server>`, etwa `srv44.mikr.us`                                        |
   | `DEPLOY_PORT`        | `<port>`, etwa `10123`                                                  |
   | `DEPLOY_KNOWN_HOSTS` | Ausgabe von `ssh-keyscan` (optional, schützt vor einem falschen Server) |

   Optional `DEPLOY_USER` (Standard `root`) und `DEPLOY_DIR` (Standard `/opt/aquisiteur`).

3. Den privaten Schlüssel vom Server löschen, er liegt jetzt nur noch bei GitHub:
   `rm /root/.ssh/github-deploy`.

Ab dann läuft nach jedem Merge **Actions → Image** mit den Jobs „Build and push the app image“ und
„Deploy to staging“. Von Hand anstoßen: **Actions → Image → Run workflow** (geht auch in der
GitHub-App). Ohne die Secrets überspringt der Workflow das Deployment.

### Produktion: nur freigegebene Versionen

Staging bekommt jeden Merge, Produktion nur, was du freigibst (ADR-0057). Beide sind immer getrennte
Installationen mit eigener Datenbank, eigenen Dateien und eigenen Subdomains. Ob sie auf einem Server
liegen oder auf zwei, entscheiden nur die Secrets; ein Umzug von Staging auf einen eigenen Server
später heißt: dort Schritt 3 bis 6 und die `DEPLOY_*`-Secrets ändern.

**Für beide Varianten:**

1. In der `.env` der Produktion zusätzlich `APP_IMAGE=ghcr.io/tsh3rr/aquisiteur:production`
   eintragen. Ohne diese Zeile lädt sie `latest` und damit jeden Merge wie Staging.
2. Für Produktion einen eigenen Deploy-Schlüssel wie oben anlegen (`github-deploy-prod`, beschränkt
   auf `cd /opt/aquisiteur && …`) und als Secrets `PROD_DEPLOY_SSH_KEY`, `PROD_DEPLOY_HOST`,
   `PROD_DEPLOY_PORT` eintragen, optional `PROD_DEPLOY_KNOWN_HOSTS`, `PROD_DEPLOY_USER`,
   `PROD_DEPLOY_DIR`. Die `DEPLOY_*`-Secrets gehören zu Staging.
3. Der stündliche Job und das Backup aus Schritt 8 laufen für Produktion; für Staging reicht der Job.

**Getrennte Server** (sicherer, empfohlen): Staging bleibt, wie es ist, etwa auf dem kleinen
Mikrus, Produktion bekommt einen eigenen Server mit Schritt 1 bis 8 in `/opt/aquisiteur`. Ein Fehler
im ungeprüften Staging-Stand trifft so nie Produktion.

**Ein gemeinsamer Server** (spart einen Server): Produktion in `/opt/aquisiteur`, Staging daneben in
`/opt/aquisiteur-staging` (Schritt 3 bis 6 in diesem Ordner). Die Staging-`.env` bekommt:

```bash
COMPOSE_PROJECT_NAME=aquisiteur-staging   # sonst teilen sich beide Container und Datenbank
APP_PORT=8080                             # Produktion belegt Port 80
APP_URL=https://aquisiteur-staging.mikrus.dev
```

Bei Mikrus dafür eigene Subdomains auf Port 8080 anlegen, etwa `aquisiteur-staging.mikrus.dev` und
`coalform-staging.mikrus.dev` (Slug `coalform-staging` beim ersten Login). Der Staging-Schlüssel ist
auf `cd /opt/aquisiteur-staging && …` beschränkt, und `DEPLOY_DIR` ist `/opt/aquisiteur-staging`.
Beide teilen sich Docker und Arbeitsspeicher; Staging sollte deshalb keine echten Kundendaten haben.

Freigeben, auf eine von zwei Arten:

- **Actions → Release → Run workflow** auf `main` (geht in der GitHub-App): bringt den aktuellen Stand
  von `main` in Produktion.
- Einen Tag wie `v2026.10.20` setzen, etwa über **Releases → Draft a new release**: bringt genau
  diesen Commit in Produktion, und das Image bekommt den Tag als Namen.

Zurück auf eine frühere Version: **Actions → Release → Run workflow** und statt `main` den älteren Tag
wählen. Die Datenbank bleibt dabei, wie sie ist; Migrationen halten die vorige Version lauffähig.
Freigaben warten aufeinander, statt sich abzubrechen. Ohne die `PROD_DEPLOY_*`-Secrets bekommt das
Image nur den Namen `production`, ein Server wird nicht angefasst.

## Für den echten Betrieb

Der Grundaufbau oben reicht zum Testen. Vor dem ersten echten Kunden kommen dazu:

- **E-Mail über Resend** (Anmeldelinks, Benachrichtigungen, Rechnungen): bei Resend **Domains → Add
  domain**, Region **EU (Ireland)**, z. B. `mail.aquisiteur.de`, SPF und DKIM eintragen und
  verifizieren lassen; **API Keys → Create** mit _Sending access_. Für den Zustellstatus von
  Rechnungsmails **Webhooks → Add endpoint** mit `https://<APP_URL>/api/webhooks/resend` und den
  Ereignissen `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`,
  `email.complained`, `email.failed`. In der `.env`: `EMAIL_PROVIDER=resend`, `EMAIL_FROM`,
  `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` (das _Signing secret_ `whsec_…`), und `ALLOW_LOG_EMAIL`
  löschen, sonst kann jeder mit Zugriff auf die Logs Anmeldelinks lesen.
- **Backups außer Haus**: bei Cloudflare einen R2-Bucket `aquisiteur-backups` mit Jurisdiktion **EU**
  und einen Token nur für diesen Bucket anlegen; die täglichen Dumps aus Schritt 8 mit `rclone copy`
  dorthin schieben. Einmal üben, einen Dump zurückzuspielen; erst dann ist es ein Backup.
- **Dateien in R2** statt im Volume (optional): Bucket `aquisiteur-files` (EU), in der `.env`
  `STORAGE_PROVIDER=s3`, `S3_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com`,
  `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Bestehende Dateien vorher mit `rclone`
  aus dem Volume `files` kopieren.
- **Geheimnisse sichern**: `INTEGRATIONS_ENCRYPTION_KEY` besonders gut aufheben; ohne ihn lassen sich
  gespeicherte Zugangsdaten (etwa für Pingen) nicht mehr entschlüsseln. Staging und Produktion
  bekommen verschiedene Secrets.
- **Fehler-Monitoring** (optional, ADR-0044): Sentry-Projekt mit Datenregion EU, DSN als `SENTRY_DSN`.
  Ohne DSN stehen Fehler in `docker compose logs app`.
- **Erreichbarkeit**: ein kostenloser Monitor (z. B. UptimeRobot) auf `https://<APP_URL>/healthz`.
- **Eigenes Cloudflare davor** (nur falls später gewünscht, etwa für eine eigene Domain mit Stadt in
  der Timeline): erst die Transform Rule „Origin-Schutz“ anlegen, die den Header
  `x-aquisiteur-origin` mit dem Wert von `ORIGIN_SECRET` setzt, dann `ORIGIN_SECRET` in der `.env`
  setzen (`docs/SECURITY.md`, ADR-0064). Ohne Cloudflare bleibt `ORIGIN_SECRET` leer.

Monatlich (15 bis 30 Minuten): per SSH `apt update && apt -y upgrade`, `df -h` für den Plattenplatz,
die Backups der letzten Tage prüfen. Einstellungen → System im Cockpit zeigt Datenbankgröße und
Dateispeicher (nur für `PLATFORM_ADMIN_EMAILS`).

## Sicherheit

Die App nimmt die Adresse eines Besuchers aus dem letzten Eintrag von `x-forwarded-for`, den der Proxy
von Mikrus anhängt, und ignoriert Cloudflare-Header (`cf-*`), solange `ORIGIN_SECRET` leer ist (ADR-0064).
`ORIGIN_SECRET` hier also leer lassen. Port 80 ist für den Proxy von Mikrus offen und damit auch direkt
erreichbar; wer so kommt, kann seine Adresse frei wählen. Die festen Grenzen pro E-Mail-Adresse und
pro Workspace gelten trotzdem (`docs/SECURITY.md`).

## Wenn etwas hakt

| Zeichen                                 | Ursache und Abhilfe                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `unauthorized` beim Laden des Images    | `docker login ghcr.io` fehlt oder das Token hat kein `read:packages`.                                 |
| `set POSTGRES_PASSWORD in .env`         | Schritt 4, erste Zeile, fehlt.                                                                        |
| Seite antwortet `404 Unknown host`      | Adresse passt weder zu `APP_URL` noch zu `<slug>.<PLATFORM_DOMAIN>`.                                  |
| `expose:publish` bricht mit Code 143 ab | Auf dem Server zu wenig Speicher für die Bilder: auf dem eigenen Rechner veröffentlichen (Schritt 7). |
| Mikrus meldet, dass kein Server lauscht | App läuft nicht: `docker compose ps` und `docker compose logs app`.                                   |
| Deploy-Job: `Permission denied`         | Schlüssel fehlt in `authorized_keys` oder `DEPLOY_SSH_KEY` ist unvollständig kopiert.                 |
| Deploy-Job: `Host key verification`     | `DEPLOY_KNOWN_HOSTS` passt nicht zu Server und Port: `ssh-keyscan` erneut ausführen.                  |
