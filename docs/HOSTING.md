# Hosting-Portabilität und Umzug

Betrieben wird Aquisiteur auf einem eigenen Server (Mikrus) mit Docker Compose und einem Image aus GitHub Actions (ADR-0054, ADR-0079, Anleitung in
[DEPLOY.md](./DEPLOY.md)). Die Cloudflare-Variante ist im Code vollständig erhalten
([DEPLOY_CLOUDFLARE.md](./DEPLOY_CLOUDFLARE.md)). Ein Umzug ist ein Konfigurationswechsel (ZIELPROMPT §5a).

## Was heute anbieterneutral ist

| Baustein                                                  | Stand Phase 0                                                                                    | Umzug                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Datenbank                                                 | Standard-Postgres, Drizzle-Migrationen als einzige Quelle der Wahrheit                           | `pg_dump` / `pg_restore` zum neuen Anbieter, `DATABASE_URL` umstellen                          |
| Auth                                                      | Better Auth, Tabellen in der eigenen DB                                                          | wandert mit der DB mit                                                                         |
| DB-Verbindung                                             | `DatabasePort`: Hyperdrive (`cloudflare`) oder `DATABASE_URL` (`node`)                           | `HOSTING_PROFILE=node`                                                                         |
| E-Mail                                                    | `EmailPort`: Resend (anbieterneutral, läuft überall)                                             | nichts zu tun                                                                                  |
| Rate Limiting (Auth)                                      | Better Auth mit Postgres-Speicher                                                                | nichts zu tun                                                                                  |
| Storage (Bilder, Videos)                                  | `StoragePort`: S3-API (im Betrieb R2) oder Verzeichnis auf dem Server (Volume)                   | anderes S3 (MinIO, Supabase Storage, Hetzner): `S3_*` umstellen, Dateien mit `rclone` kopieren |
| Queue, Cron, Cache, Realtime, Domains, Push, Briefversand | Schnittstellen in `src/infra/types.ts` deklariert, Implementierung folgt in der jeweiligen Phase | je Port ein Adapter (pg-boss, node-cron …)                                                     |

Fachcode importiert Anbieter-SDKs nie direkt; die ESLint-Regel in `eslint.config.mjs` erzwingt das
außerhalb von `src/infra/` (getestet in `tests/unit/infra-boundary.test.ts`).

## Variante A: eigener Server mit Docker Compose, Standard

Ausführlich in [DEPLOY.md](./DEPLOY.md). Umzug von Supabase auf den Server:

1. Server mit Docker aufsetzen, `deploy/compose.yml` und `.env` nach `/opt/aquisiteur` (DEPLOY.md
   Schritt 1 bis 4), nur die Datenbank starten: `docker compose up -d db`.
2. Daten übertragen (die neue Datenbank ist der Container `db`):
   ```bash
   pg_dump --no-owner --no-privileges -Fc "$ALTE_DATABASE_URL" > aquisiteur.dump
   docker compose exec -T db psql -U aquisiteur -d aquisiteur -c "create role aquisiteur_app nologin noinherit"
   docker compose exec -T db pg_restore -U aquisiteur -d aquisiteur --no-owner < aquisiteur.dump
   ```
3. `docker compose up -d`: die App spielt beim Start die Migrationen ein (stellt Rolle, Grants und
   Funktionen sicher).
4. Domains auf den Server zeigen lassen; auf Mikrus über die Subdomains im Panel (DEPLOY.md Schritt 1).

## Variante B: Vercel

1. Projekt aus dem Repo importieren (Framework Next.js, pnpm wird erkannt).
2. Env-Variablen setzen, `HOSTING_PROFILE=node`, Function-Region `fra1`.
3. `DATABASE_URL` auf Supabase (Session Pooler) zeigen lassen.
4. Domains `app.<domain>` und `*.<domain>` (Wildcard erfordert Vercel-Nameserver) hinzufügen.

## Was beim Umzug zu prüfen ist

- Migrationen gegen die neue DB laufen lassen (`pnpm db:migrate`), dann `pnpm test:db` gegen eine Kopie.
- Passkeys hängen an der Domain (`APP_URL`). Bleibt die Cockpit-Domain gleich, funktionieren sie weiter.
- Ports ohne Adapter für das neue Ziel: zuerst den Adapter in `src/infra/<anbieter>/` bauen.
