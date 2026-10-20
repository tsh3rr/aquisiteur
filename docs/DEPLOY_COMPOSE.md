# Deployment ohne Coolify: Docker Compose auf einem kleinen Server

Für Server mit wenig Speicher (etwa einen Mikrus mit 1 GB zum Testen). Statt Coolify laufen nur zwei
Container: Postgres und das fertige App-Image von GitHub (ADR-0053, ADR-0054). Zusammen brauchen sie rund
150 MB. Mikrus macht das HTTPS und reicht HTTP an Port 80 weiter, ein Proxy ist nicht nötig. Für den
echten Betrieb mit Cloudflare und R2 gilt [DEPLOY.md](./DEPLOY.md).

Die Beispiele nutzen `aquisiteur.mikrus.dev` für das Cockpit und `coalform.mikrus.dev` für einen
Workspace. Der SSH-Zugang steht in der Willkommens-Mail von Mikrus (`ssh -p <port> root@<server>`).

## 1. Coolify entfernen (falls installiert)

Entfernt Coolify samt seiner Datenbank und allen Containern auf dem Server. Docker bleibt.

```bash
timeout 60 systemctl restart docker   # hängt das, den Server im Mikrus-Panel neu starten
docker rm -f $(docker ps -aq)
docker volume rm $(docker volume ls -q)
docker network prune -f
docker image prune -af
rm -rf /data/coolify
```

Prüfen: `docker ps -a` zeigt nur noch die Kopfzeile, `docker compose version` antwortet.

## 2. Subdomains bei Mikrus

Im Mikrus-Panel zwei Subdomains auf **Port 80**, Haken „Port źródłowy jest HTTPS“ **aus**:
`aquisiteur.mikrus.dev` (Cockpit) und `coalform.mikrus.dev` (Workspace mit den Exposés). Jeder weitere
Workspace bekommt hier eine eigene Subdomain.

## 3. Image laden dürfen

Das Image `ghcr.io/tsh3rr/aquisiteur` ist privat. Auf GitHub unter **Settings → Developer settings →
Personal access tokens → Tokens (classic)** ein Token nur mit `read:packages` anlegen, dann auf dem
Server:

```bash
docker login ghcr.io -u <github-name>   # Token als Passwort
```

## 4. Dateien auf den Server

Auf deinem Rechner im Repo-Ordner (aktueller Stand von `main`):

```bash
ssh -p <port> root@<server> "mkdir -p /opt/aquisiteur"
scp -P <port> deploy/compose.yml root@<server>:/opt/aquisiteur/compose.yml
scp -P <port> deploy/env.example root@<server>:/opt/aquisiteur/.env
```

## 5. Einstellungen in `.env`

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
Adresse sein, mit der du dich in Schritt 7 anmeldest. Die letzte zeigt nur den Anfang der Werte zur
Kontrolle. `APP_URL` und `PLATFORM_DOMAIN` prüfen (`nano .env`; Text aus Windows mit Rechtsklick
einfügen, speichern mit Strg+O, Enter, Strg+X).

Die Datei enthält alle Geheimnisse. Eine Kopie gehört in den Passwortmanager, etwa so geholt (auf deinem
Rechner, nicht in den Repo-Ordner): `scp -P <port> root@<server>:/opt/aquisiteur/.env aquisiteur.env`.

## 6. Starten

```bash
docker compose up -d
docker compose ps        # beide "Up", die App nach etwa einer Minute "(healthy)"
docker compose logs app  # "Migrations applied." und "Ready"
```

`https://aquisiteur.mikrus.dev/healthz` antwortet mit `ok`. Container starten nach einem Neustart des
Servers von selbst.

## 7. Erster Login

```bash
docker compose exec app pnpm user:login deine@adresse.de --name "Vorname Nachname" \
  --workspace "Coalform" --slug coalform
```

Gibt einen Anmeldelink aus (30 Minuten gültig, einmal nutzbar). Der Workspace liegt dann unter
`coalform.mikrus.dev`. Weitere Anmeldelinks stehen im Log (`docker compose logs app | grep -i http`),
solange Mails ins Log gehen (`EMAIL_PROVIDER=log`).

## 8. Exposés veröffentlichen

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

## 9. Stündlicher Job und tägliches Backup

`crontab -e` und diese zwei Zeilen anhängen:

```
5 * * * * cd /opt/aquisiteur && docker compose exec -T app pnpm jobs:hourly >> /var/log/aquisiteur-hourly.log 2>&1
0 3 * * * mkdir -p /root/backups && cd /opt/aquisiteur && docker compose exec -T db pg_dump -U aquisiteur -Fc aquisiteur > /root/backups/aquisiteur-$(date +\%F).dump && find /root/backups -name '*.dump' -mtime +14 -delete
```

Ein Backup auf demselben Server schützt nicht vor dessen Verlust. Ab und zu herunterladen
(`scp -P <port> root@<server>:/root/backups/*.dump .`) oder für den echten Betrieb R2 nutzen.

Zurückspielen: `docker compose exec -T db pg_restore -U aquisiteur -d aquisiteur --clean --if-exists < datei.dump`.

## 10. Updates

Nach jedem Merge auf `main` baut GitHub ein neues Image (Actions → Image). Dann auf dem Server:

```bash
cd /opt/aquisiteur && docker compose pull app && docker compose up -d
```

Die App spielt beim Start die Migrationen ein.

## Wenn etwas hakt

| Zeichen                                 | Ursache und Abhilfe                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `unauthorized` beim Laden des Images    | `docker login ghcr.io` fehlt oder das Token hat kein `read:packages`.                                 |
| `set POSTGRES_PASSWORD in .env`         | Schritt 5, erste Zeile, fehlt.                                                                        |
| Seite antwortet `404 Unknown host`      | Adresse passt weder zu `APP_URL` noch zu `<slug>.<PLATFORM_DOMAIN>`.                                  |
| `expose:publish` bricht mit Code 143 ab | Auf dem Server zu wenig Speicher für die Bilder: auf dem eigenen Rechner veröffentlichen (Schritt 8). |
| Mikrus meldet, dass kein Server lauscht | App läuft nicht: `docker compose ps` und `docker compose logs app`.                                   |
