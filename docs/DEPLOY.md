# Deployment: Mikrus 3.5 mit Coolify hinter Cloudflare

Schritt-für-Schritt-Anleitung, um Aquisiteur auf einem Mikrus 3.5 zu betreiben (ADR-0047, ADR-0052).
Coolify ist eine Weboberfläche auf dem Server: Sie verbindet das GitHub-Repo, baut jeden Push selbst und
verwaltet die Datenbank samt Backups. Die Datenbank liegt auf dem Server, Bilder, Videos und
Aufzeichnungen sowie die Datenbank-Backups in Cloudflare R2. Cloudflare steht vor allen Domains, weil
Mikrus keine eigene IPv4-Adresse vergibt. Ein Server reicht für mehrere Prototypen. Zeitaufwand beim
ersten Mal: ein halber bis ganzer Tag, danach 15 bis 30 Minuten im Monat.

Auf einem Server mit eigener IPv4 (z. B. Hetzner) ist es einfacher, siehe „Server mit eigener IPv4“.
Für einen sehr kleinen Testserver ohne Coolify siehe [DEPLOY_COMPOSE.md](./DEPLOY_COMPOSE.md).
Die frühere Variante mit Cloudflare Workers und Supabase steht in
[DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md).

## Überblick

```
GitHub (main) ──► Coolify auf dem Server: bauen (Nixpacks) → migrieren → starten
                                                                  │
Browser ──► Cloudflare (IPv4/IPv6, TLS) ──IPv6──► Traefik (Origin-Zertifikat) ──► Aquisiteur (Node, Port 3000)
                                                                                   │             │
                                                                                   ▼             ▼
                                                                    Postgres 16 (Coolify)   R2 aquisiteur-files
                                                                                   │
                                                              tägliche Dumps ──► R2 aquisiteur-backups
```

| Was       | Wo                                               | Wofür                                  |
| --------- | ------------------------------------------------ | -------------------------------------- |
| Server    | Mikrus 3.5 (Rechenzentrum Helsinki, Finnland)    | App und Datenbank                      |
| Zugang    | Cloudflare (Proxy, DNS, Origin-Zertifikat)       | Erreichbarkeit per IPv4, TLS, Stadt    |
| App       | Coolify-Anwendung aus GitHub                     | Cockpit, Exposés, Kurzlinks, Live-Chat |
| Datenbank | Postgres 16 als Coolify-Ressource                | Alle Daten inkl. Logins (Better Auth)  |
| Dateien   | R2-Bucket `aquisiteur-files` (Jurisdiktion EU)   | Bilder, Videos, Aufzeichnungen         |
| Backups   | R2-Bucket `aquisiteur-backups` (Jurisdiktion EU) | Tägliche Datenbank-Dumps               |
| E-Mail    | Resend (EU-Region)                               | Anmeldelinks und Benachrichtigungen    |

**Was bei Mikrus anders ist als bei einem normalen Server:**

- Keine eigene IPv4-Adresse. Die Ports 80 und 443 gibt es nur über IPv6, deshalb läuft der Verkehr
  über Cloudflare. Cloudflare spricht per IPv6 mit dem Server.
- SSH läuft über einen eigenen Port, den Mikrus nennt, nicht über Port 22.
- Das HTTPS-Zertifikat kommt von Cloudflare (Origin-Zertifikat) statt von Let's Encrypt.
- Kein Platten-Backup per Klick. Datenbank-Backups und Dateien liegen deshalb in R2.
- Die geteilte 300-MB-Datenbank von Mikrus wird nicht genutzt; die Migrationen brauchen eine eigene
  Rolle (ADR-0052).

**Warum E-Mail nicht vom eigenen Server?** Mails von einer frischen Server-Adresse landen oft im Spam.
Resend kümmert sich um Zustellbarkeit und kostet bis 3.000 Mails im Monat nichts; Aquisiteur verschickt
nur Anmeldelinks und Benachrichtigungen.

## Voraussetzungen

- Ein Mikrus 3.5 (4 GB RAM, 40 GB Platte). Mit 2 GB (Mikrus 3.0) bricht der Build ab, weil Coolify,
  Postgres und der Next-Build gleichzeitig Speicher brauchen. Zum Testen reicht ein kleinerer Server,
  wenn GitHub das Image baut (Schritt 7, „fertiges Image von GitHub“).
- Ein kostenloses Cloudflare-Konto, auf dem die Domain liegt (Nameserver bei Cloudflare)
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

## 2. Server mieten und absichern

1. Auf [mikr.us](https://mikr.us) einen **Mikrus 3.5** bestellen. Aus der Willkommensmail notieren:
   Servername (z. B. `srv12.mikr.us`), SSH-Port, die **IPv6-Adresse** und das Root-Passwort.
2. Im Mikrus-Panel als Betriebssystem **Ubuntu 24.04** wählen, falls eine Auswahl angeboten wird.
3. Den öffentlichen SSH-Schlüssel hinterlegen: anmelden mit `ssh root@srv12.mikr.us -p <port>` und den
   Inhalt von `~/.ssh/id_ed25519.pub` (unter Windows `C:\Users\<du>\.ssh\id_ed25519.pub`) in
   `/root/.ssh/authorized_keys` eintragen. Prüfen, dass die Anmeldung ohne Passwort klappt.
4. Erst dann die Grundabsicherung einschalten:

   ```bash
   apt update && apt -y upgrade
   apt -y install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades
   # Anmeldung nur noch per Schlüssel
   sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```

5. Prüfen, dass IPv6 funktioniert: `ping -6 -c 3 google.com` muss antworten.

## 3. Coolify installieren

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
docker run --rm hello-world   # muss „Hello from Docker!“ ausgeben
```

Läuft Docker nicht, geht es hier nicht weiter: Coolify braucht Docker. Die Oberfläche (Port 8000) über
einen SSH-Tunnel öffnen, nicht von außen:

```bash
ssh -L 8000:localhost:8000 root@srv12.mikr.us -p <port>
```

Solange das Fenster offen ist, ist Coolify unter `http://localhost:8000` erreichbar. Admin-Konto
anlegen. Den Tunnel braucht es nur, bis Coolify in Schritt 4 eine eigene Adresse hat.

Über IPv6 ist der Server von außen direkt erreichbar. Von einem anderen Rechner mit IPv6 prüfen, dass
`curl -6 -m 5 http://[<ipv6>]:8000` keine Antwort bekommt. Antwortet Coolify dort, ist das Admin-Login
öffentlich; dann den Port sperren, bevor es weitergeht.

## 4. Cloudflare: DNS und Zertifikat

Besucher kommen per IPv4 oder IPv6 zu Cloudflare, Cloudflare spricht per IPv6 mit dem Server.

**DNS-Einträge** (Cloudflare → Domain → DNS), alle als **AAAA** auf die IPv6 des Servers und mit
**oranger Wolke** (Proxy an). Ein A-Eintrag fehlt absichtlich.

| Name                  | Typ  | Ziel             | Proxy |
| --------------------- | ---- | ---------------- | ----- |
| `app`                 | AAAA | IPv6 des Servers | an    |
| `coolify`             | AAAA | IPv6 des Servers | an    |
| `*` (alle Workspaces) | AAAA | IPv6 des Servers | an    |

**Zertifikat und Einstellungen:**

1. **SSL/TLS → Origin Server → Create Certificate**, Hostnamen `aquisiteur.de` und `*.aquisiteur.de`,
   Gültigkeit 15 Jahre. Zertifikat und privaten Schlüssel in den Passwortmanager.
2. In Coolify unter **Servers → localhost → Proxy** das Zertifikat als eigenes Zertifikat für Traefik
   hinterlegen.
3. **SSL/TLS → Overview**: Modus **Full (strict)**.
4. **Rules → Managed Transforms → Add visitor location headers** einschalten. Dann zeigt die Timeline die
   Stadt eines Besuchs (`cf-ipcity`). Die App liest Cloudflare-Header nur mit Origin-Schutz (Schritt 5).
5. **Rules → Transform Rules → Request Header Transform Rules → Create rule** (Name „Origin-Schutz“):
   „All incoming requests“, **Set static** Header `x-aquisiteur-origin` mit dem Wert von `ORIGIN_SECRET`
   aus `pnpm deploy:secrets`. Erst die Regel anlegen, dann die Variable in Schritt 8 setzen. Damit
   antwortet die App nur noch auf Anfragen, die über Cloudflare kommen; wer den Server direkt über seine
   IPv6 anspricht, bekommt 403 und kann die Adresse für die Rate Limits nicht fälschen
   (`docs/SECURITY.md`, ADR-0064). `/healthz` bleibt für den Health Check von Coolify erreichbar.
6. In Coolify unter **Settings** die Instanz-Domain `https://coolify.aquisiteur.de` eintragen. Ab jetzt
   braucht es den SSH-Tunnel nicht mehr.

**Später eine neue Domain** (etwa für ein anderes Projekt): bei Cloudflare den AAAA-Eintrag mit oranger
Wolke anlegen, ein Origin-Zertifikat dafür erzeugen und in Coolify eintragen. Eine Subdomain von
`aquisiteur.de` braucht nur den Eintrag in Coolify, das Wildcard-Zertifikat deckt sie ab.

## 5. Resend anlegen

1. **Domains → Add domain**, Region **EU (Ireland)**, z. B. `mail.aquisiteur.de`; die DNS-Einträge (SPF,
   DKIM) anlegen und verifizieren lassen.
2. **API Keys → Create** mit _Sending access_.
3. Für den Zustellstatus von Rechnungsmails: **Webhooks → Add endpoint** mit
   `https://<APP_URL>/api/webhooks/resend` und den Ereignissen `email.sent`, `email.delivered`,
   `email.delivery_delayed`, `email.bounced`, `email.complained` und `email.failed`. Das
   _Signing secret_ (`whsec_…`) kommt in `RESEND_WEBHOOK_SECRET`.

Zum ersten Ausprobieren geht es auch ohne Resend, siehe „Ohne E-Mail-Versand testen“.

## 6. Datenbank in Coolify

1. In Coolify **Projects → New** `aquisiteur`, darin **New resource → Database → PostgreSQL 16**.
2. Name `aquisiteur-db`, **Start**. Coolify erzeugt Benutzer und Passwort. Die **interne URL**
   (`postgres://postgres:…@aquisiteur-db:5432/postgres`, nur im Server-Netz erreichbar) ist die
   **Datenbank-URL** für Schritt 8. Die Datenbank bleibt von außen unerreichbar („Make it publicly
   available“ aus lassen).
3. **Backups außer Haus**: bei Cloudflare zwei R2-Buckets anlegen, beide mit Jurisdiktion **EU**:
   `aquisiteur-backups` und `aquisiteur-files` (für Schritt 8). Je einen API-Token mit Lese- und
   Schreibrecht nur für den jeweiligen Bucket erzeugen.
4. In Coolify unter **Settings → S3 Storages** den Bucket `aquisiteur-backups` eintragen (Endpunkt
   `https://<account-id>.eu.r2.cloudflarestorage.com`).
5. In der Datenbank **Backups → Scheduled backup**: täglich (`0 3 * * *`), **Save to S3** mit dem Bucket
   aus Schritt 6.4, Aufbewahrung 14 Tage. Einmal **Backup now** und prüfen, dass die Datei im Bucket
   ankommt. Einmal üben, ein Backup zurückzuspielen (siehe „Wiederherstellen“); erst dann ist es eins.

Die Tabellen legst du nicht von Hand an: Das erledigt jeder Start der App (Schritt 7).

## 7. App aus GitHub anlegen

1. Im Projekt **New resource → Application → Private repository (with GitHub App)**. Coolify führt durch
   die Installation seiner GitHub-App; Zugriff nur auf `tsh3rr/aquisiteur` geben.
2. Branch `main`, Build Pack **Nixpacks**. Die Datei `nixpacks.toml` im Repo legt Node 22, den Build
   (`pnpm build`) und den Start fest: erst `pnpm db:migrate`, dann `pnpm start`.
3. **Ports Exposes**: `3000`.
4. **Domains**: `https://app.aquisiteur.de,https://pixelwerk.aquisiteur.de` (Cockpit plus die Adresse
   jedes Workspaces, kommagetrennt; nach dem Einrichtungs-Assistenten ergänzen). Traefik liefert das
   Origin-Zertifikat aus Schritt 4 aus; ein Let's-Encrypt-Zertifikat holt Coolify hinter Cloudflare
   nicht.
5. Kein Volume nötig: Dateien liegen in R2 (Schritt 8).
6. **Health check**: Pfad `/healthz`, Port 3000 (antwortet erst, wenn die Datenbank erreichbar ist). So geht eine neue Version erst live, wenn sie antwortet.
7. **Auto deploy** an: jeder Push auf `main` baut und veröffentlicht neu.

### Variante: fertiges Image von GitHub (Server mit wenig RAM)

Der Next-Build braucht gut 1 GB Speicher zusätzlich zu Coolify und Postgres. Auf kleineren Servern (etwa
einem Mikrus mit 1 oder 2 GB zum Testen) baut deshalb GitHub das Image, und Coolify lädt es nur noch
(ADR-0053). Die laufende App braucht rund 100 MB.

1. Auf GitHub unter **Actions → Image** einmal **Run workflow** auf `main` starten (danach läuft er bei
   jedem Push auf `main` von selbst). Das Image heißt `ghcr.io/tsh3rr/aquisiteur:latest` und ist privat.
2. Damit der Server es laden darf: auf GitHub unter **Settings → Developer settings → Personal access
   tokens → Tokens (classic)** ein Token nur mit `read:packages` anlegen. Per SSH auf dem Server
   `docker login ghcr.io -u <github-name>` und das Token als Passwort eingeben.
3. In Coolify **New resource → Docker Image**, Image `ghcr.io/tsh3rr/aquisiteur`, Tag `latest`.
   Ports, Domains, Health check und Umgebungsvariablen wie in den Schritten 7 und 8. Das Image startet
   wie Nixpacks: erst die Migrationen, dann die App.
4. Optional automatisch live: in der App unter **Webhooks** die Deploy-URL kopieren und unter **Keys &
   Tokens → API tokens** ein Token mit Recht `deploy` anlegen. Beides auf GitHub unter **Settings →
   Secrets and variables → Actions** als `COOLIFY_WEBHOOK` und `COOLIFY_TOKEN` eintragen. Ohne die
   beiden Secrets in Coolify nach jedem neuen Image **Redeploy** klicken.

Die App läuft als **eine** Instanz. Live-Chat und Live-Feed laufen dann direkt aus dem Node-Prozess
(Server-Sent Events, `REALTIME_PROVIDER=memory`), ohne weiteren Dienst.

## 8. Umgebungsvariablen

Im Projekt `aquisiteur` unter **Environment Variables** (Secrets mit „Is secret?“ markieren).
Die Geheimnisse erzeugt `pnpm deploy:secrets` lokal (`BETTER_AUTH_SECRET`,
`INTEGRATIONS_ENCRYPTION_KEY`, `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`); alles in den
Passwortmanager. `INTEGRATIONS_ENCRYPTION_KEY` besonders gut sichern.

| Name                          | Wert                                                                               | Secret |
| ----------------------------- | ---------------------------------------------------------------------------------- | ------ |
| `HOSTING_PROFILE`             | `node`                                                                             |        |
| `HOSTING_PLAN`                | `vps`                                                                              |        |
| `DATABASE_URL`                | interne Datenbank-URL aus Schritt 6                                                | ja     |
| `APP_URL`                     | `https://app.aquisiteur.de`                                                        |        |
| `PLATFORM_DOMAIN`             | `aquisiteur.de`                                                                    |        |
| `SIGNUP_ALLOWLIST`            | deine E-Mail-Adresse                                                               |        |
| `PLATFORM_ADMIN_EMAILS`       | deine E-Mail-Adresse (Einstellungen → System)                                      |        |
| `EMAIL_PROVIDER`              | `resend`                                                                           |        |
| `EMAIL_FROM`                  | `Aquisiteur <anmeldung@mail.aquisiteur.de>`                                        |        |
| `RESEND_API_KEY`              | aus Schritt 5                                                                      | ja     |
| `RESEND_WEBHOOK_SECRET`       | aus Schritt 5, Punkt 3 (Zustellstatus der Rechnungsmails)                          | ja     |
| `STORAGE_PROVIDER`            | `s3`                                                                               |        |
| `S3_ENDPOINT`                 | `https://<account-id>.eu.r2.cloudflarestorage.com`                                 |        |
| `S3_BUCKET`                   | `aquisiteur-files`                                                                 |        |
| `S3_ACCESS_KEY_ID`            | aus dem R2-Token für `aquisiteur-files`                                            | ja     |
| `S3_SECRET_ACCESS_KEY`        | aus dem R2-Token für `aquisiteur-files`                                            | ja     |
| `REALTIME_PROVIDER`           | `memory`                                                                           |        |
| `PUSH_PROVIDER`               | `webpush`                                                                          |        |
| `VAPID_PUBLIC_KEY`            | aus `pnpm deploy:secrets`                                                          |        |
| `VAPID_PRIVATE_KEY`           | aus `pnpm deploy:secrets`                                                          | ja     |
| `VAPID_SUBJECT`               | `mailto:deine@adresse.de`                                                          |        |
| `BETTER_AUTH_SECRET`          | aus `pnpm deploy:secrets`                                                          | ja     |
| `INTEGRATIONS_ENCRYPTION_KEY` | aus `pnpm deploy:secrets`                                                          | ja     |
| `CRON_SECRET`                 | aus `pnpm deploy:secrets`                                                          | ja     |
| `ORIGIN_SECRET`               | aus `pnpm deploy:secrets`, derselbe Wert wie in der Transform Rule (Schritt 4)     | ja     |
| `GEOCODER_CONTACT`            | deine E-Mail-Adresse (für die Karte, Nominatim)                                    |        |
| `SENTRY_DSN`                  | optional, Sentry-Projekt in der Region EU; ohne Sentry die Variable ganz weglassen | ja     |

Dann **Deploy**. Der erste Build dauert einige Minuten (**Deployments → Logs**).

**Fehler-Monitoring (optional, ADR-0044):** Sentry-Projekt in einer Organisation mit Datenregion EU
anlegen, DSN (`https://<key>@o<nr>.ingest.de.sentry.io/<projekt>`) als `SENTRY_DSN`. Ohne DSN landen
Fehler im Log der App in Coolify.

## 9. Stündlicher Job

Erinnerungen an Aufgaben, Tageszusammenfassung, automatische Löschung nach Fristen und die Karte brauchen einen stündlichen
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

- **Datenbank:** in Coolify **Backups → Restore**, oder einen Dump mit
  `pg_restore --no-owner -d "$DATABASE_URL" backup.dump` einspielen, danach `pnpm db:migrate`.
- **Ganzer Server:** neuen Server wie in Schritt 2 bis 7 aufsetzen, den letzten Dump aus
  `aquisiteur-backups` einspielen und die AAAA-Einträge bei Cloudflare auf die neue IPv6 umstellen. Die
  Dateien liegen in R2 und bleiben, wo sie sind.
- **Dateien:** R2 speichert redundant, schützt aber nicht vor versehentlichem Löschen. Wer eine zweite
  Kopie will, spiegelt `aquisiteur-files` mit `rclone sync` in einen anderen Bucket.

## Überwachung

- **Monatlich (15 bis 30 Minuten):** per SSH `apt update && apt -y upgrade`, in Coolify nach Updates
  schauen, in `aquisiteur-backups` die Backups der letzten Tage prüfen, unter **Servers** den freien
  Plattenplatz ansehen.
- **Erreichbarkeit:** ein kostenloser Monitor (z. B. UptimeRobot) auf `https://app.aquisiteur.de/healthz`.
- **Fehler:** Sentry (optional, siehe Schritt 8) oder die Logs in Coolify.
- **Platz und Limits:** Einstellungen → System zeigt Datenbankgröße und Dateispeicher (nur für
  `PLATFORM_ADMIN_EMAILS`). Plattenplatz des Servers zeigt Coolify unter **Servers**.

## Fehlerbehebung

| Symptom                                    | Ursache und Lösung                                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Start bricht mit `DATABASE_URL` ab         | Variable fehlt oder zeigt nicht auf die interne URL aus Schritt 6.                                                              |
| `Invalid environment configuration` im Log | Eine Variable aus Schritt 8 fehlt; das Log nennt, welche.                                                                       |
| Cloudflare zeigt Fehler 521 oder 522       | Coolify oder Traefik läuft nicht, oder der AAAA-Eintrag zeigt auf die falsche IPv6.                                             |
| Cloudflare zeigt Fehler 526                | Das Origin-Zertifikat fehlt in Traefik oder deckt den Hostnamen nicht ab.                                                       |
| Workspace-Adresse liefert 404              | Domain in Coolify nicht eingetragen (Schritt 7.4), oder der Assistent wurde nicht abgeschlossen.                                |
| Login-Mail kommt nicht                     | `EMAIL_PROVIDER` steht auf `log`, oder die Absender-Domain ist in Resend nicht verifiziert; Adresse muss in `SIGNUP_ALLOWLIST`. |
| Passkey-Fehler „origin“                    | `APP_URL` muss exakt der Adresse im Browser entsprechen (https, ohne Schrägstrich am Ende).                                     |
| Live-Chat hängt                            | Mehr als eine Instanz läuft; im Node-Profil genau eine Instanz betreiben.                                                       |
| Upload schlägt fehl, Bilder fehlen         | `S3_*` falsch, Token ohne Schreibrecht, oder der Endpunkt passt nicht zur Jurisdiktion des Buckets (`.eu.` im Hostnamen).       |
| Seite fehlt im Mobilfunknetz               | Ein A-Eintrag statt AAAA, oder der Proxy (orange Wolke) ist aus; ohne Proxy erreichen nur IPv6-Besucher den Server.             |
| Build bricht ohne klare Meldung ab         | Zu wenig Arbeitsspeicher; der Server braucht mindestens 4 GB RAM.                                                               |

## Kosten (Stand Oktober 2026, ungefähr)

| Dienst                      | Kosten                                                   |
| --------------------------- | -------------------------------------------------------- |
| Mikrus 3.5                  | 197 zł im Jahr (etwa 45 €), für alle Prototypen zusammen |
| Cloudflare (Proxy, DNS, R2) | kostenlos; R2 bis 10 GB                                  |
| Coolify (selbst betrieben)  | kostenlos                                                |
| Resend                      | kostenlos bis 3.000 Mails/Monat                          |
| Sentry                      | kostenloser Developer-Plan                               |

## Server mit eigener IPv4 (z. B. Hetzner)

Hat der Server eine eigene IPv4-Adresse und ein Platten-Backup, wird es einfacher (so war ADR-0047
gedacht):

- DNS-Einträge als A und AAAA auf den Server, bei Cloudflare-DNS mit grauer Wolke (**DNS only**); Coolify
  holt die Zertifikate selbst über Let's Encrypt, Schritt 4 entfällt bis auf die Einträge. Mit oranger
  Wolke zeigt die Timeline zusätzlich die Stadt; dann SSL/TLS auf **Full (strict)**.
- Firewall beim Anbieter: eingehend nur 22, 80, 443; Port 8000 nur vorübergehend für die eigene IP.
- Mit grauer Wolke `ORIGIN_SECRET` leer lassen: Die App nimmt dann die Adresse, die Traefik in
  `x-forwarded-for` anhängt, und ignoriert Cloudflare-Header (ADR-0064).
- Das tägliche Platten-Backup des Anbieters sichert Datenbank-Dumps und ein Volume mit. Die Dateien
  können dann statt in R2 im Volume liegen: **Persistent Storage → Volume Mount** nach `/data/files`,
  `STORAGE_PROVIDER=local`, `LOCAL_STORAGE_DIR=/data/files` (ADR-0049).
- Server mindestens 2 vCPU, 4 GB RAM, 40 GB SSD.

## Umzug zu einem anderen Hoster

Siehe [HOSTING.md](./HOSTING.md) und [DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md).
