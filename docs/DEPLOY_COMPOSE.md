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
docker compose run --rm --no-deps app pnpm deploy:secrets
nano .env
```

Der zweite Befehl lädt das Image und gibt fünf Zeilen `NAME=wert` aus. In `nano` die leeren Zeilen
`BETTER_AUTH_SECRET` bis `VAPID_PRIVATE_KEY` damit füllen, `you@example.com` durch deine Adresse ersetzen
(vier Stellen), `APP_URL` und `PLATFORM_DOMAIN` prüfen. Speichern mit Strg+O, Enter, Strg+X. Die Datei
enthält alle Geheimnisse; eine Kopie gehört in den Passwortmanager.

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

## 8. Stündlicher Job und tägliches Backup

`crontab -e` und diese zwei Zeilen anhängen:

```
5 * * * * cd /opt/aquisiteur && docker compose exec -T app pnpm jobs:hourly >> /var/log/aquisiteur-hourly.log 2>&1
0 3 * * * mkdir -p /root/backups && cd /opt/aquisiteur && docker compose exec -T db pg_dump -U aquisiteur -Fc aquisiteur > /root/backups/aquisiteur-$(date +\%F).dump && find /root/backups -name '*.dump' -mtime +14 -delete
```

Ein Backup auf demselben Server schützt nicht vor dessen Verlust. Ab und zu herunterladen
(`scp -P <port> root@<server>:/root/backups/*.dump .`) oder für den echten Betrieb R2 nutzen.

Zurückspielen: `docker compose exec -T db pg_restore -U aquisiteur -d aquisiteur --clean --if-exists < datei.dump`.

## 9. Updates

Nach jedem Merge auf `main` baut GitHub ein neues Image (Actions → Image). Dann auf dem Server:

```bash
cd /opt/aquisiteur && docker compose pull app && docker compose up -d
```

Die App spielt beim Start die Migrationen ein.

## Wenn etwas hakt

| Zeichen                                 | Ursache und Abhilfe                                                   |
| --------------------------------------- | --------------------------------------------------------------------- |
| `unauthorized` beim Laden des Images    | `docker login ghcr.io` fehlt oder das Token hat kein `read:packages`. |
| `set POSTGRES_PASSWORD in .env`         | Schritt 5, erste Zeile, fehlt.                                        |
| Seite antwortet `404 Unknown host`      | Adresse passt weder zu `APP_URL` noch zu `<slug>.<PLATFORM_DOMAIN>`.  |
| Mikrus meldet, dass kein Server lauscht | App läuft nicht: `docker compose ps` und `docker compose logs app`.   |
