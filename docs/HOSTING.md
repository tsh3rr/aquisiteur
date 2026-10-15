# Hosting-Portabilität und Umzug

Cloudflare ist das Ziel, aber kein Käfig (ZIELPROMPT §5a). Ein Umzug ist ein Konfigurationswechsel plus
Adapter für die Schnittstellen, die bis dahin nur eine Cloudflare-Implementierung haben.

## Was heute anbieterneutral ist

| Baustein                                                           | Stand Phase 0                                                                                    | Umzug                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Datenbank                                                          | Standard-Postgres, Drizzle-Migrationen als einzige Quelle der Wahrheit                           | `pg_dump` / `pg_restore` zum neuen Anbieter, `DATABASE_URL` umstellen |
| Auth                                                               | Better Auth, Tabellen in der eigenen DB                                                          | wandert mit der DB mit                                                |
| DB-Verbindung                                                      | `DatabasePort`: Hyperdrive (`cloudflare`) oder `DATABASE_URL` (`node`)                           | `HOSTING_PROFILE=node`                                                |
| E-Mail                                                             | `EmailPort`: Resend (anbieterneutral, läuft überall)                                             | nichts zu tun                                                         |
| Rate Limiting (Auth)                                               | Better Auth mit Postgres-Speicher                                                                | nichts zu tun                                                         |
| Storage, Queue, Cron, Cache, Realtime, Domains, Push, Briefversand | Schnittstellen in `src/infra/types.ts` deklariert, Implementierung folgt in der jeweiligen Phase | je Port ein Adapter (S3/MinIO, pg-boss, node-cron …)                  |

Fachcode importiert Anbieter-SDKs nie direkt; die ESLint-Regel in `eslint.config.mjs` erzwingt das
außerhalb von `src/infra/` (getestet in `tests/unit/infra-boundary.test.ts`).

## Variante A: eigener Server (Hetzner + Coolify)

1. Server (z. B. Hetzner CX22, Falkenstein/Nürnberg) mit Coolify aufsetzen.
2. Postgres 16 als Coolify-Ressource anlegen, Daten übertragen:
   ```bash
   pg_dump --no-owner --no-privileges -Fc "$ALTE_DATABASE_URL" > aquisiteur.dump
   psql "$NEUE_DATABASE_URL" -c "create role aquisiteur_app nologin noinherit"
   pg_restore --no-owner -d "$NEUE_DATABASE_URL" aquisiteur.dump
   DATABASE_URL="$NEUE_DATABASE_URL" pnpm db:migrate   # stellt Rolle, Grants und Funktionen sicher
   ```
3. In Coolify eine Anwendung aus dem GitHub-Repo anlegen (Nixpacks, Node 22):
   Build `pnpm install --frozen-lockfile && pnpm build`, Start `pnpm start`, Port 3000.
4. Env-Variablen aus `.env.example` setzen, dabei `HOSTING_PROFILE=node`.
5. Domains: `app.<domain>` und `*.<domain>` auf den Server zeigen lassen; Coolify (Traefik) holt die
   Zertifikate. Für Wildcard-Zertifikate DNS-Challenge konfigurieren.

## Variante B: Vercel

1. Projekt aus dem Repo importieren (Framework Next.js, pnpm wird erkannt).
2. Env-Variablen setzen, `HOSTING_PROFILE=node`, Function-Region `fra1`.
3. `DATABASE_URL` auf Supabase (Session Pooler) zeigen lassen.
4. Domains `app.<domain>` und `*.<domain>` (Wildcard erfordert Vercel-Nameserver) hinzufügen.

## Was beim Umzug zu prüfen ist

- Migrationen gegen die neue DB laufen lassen (`pnpm db:migrate`), dann `pnpm test:db` gegen eine Kopie.
- Passkeys hängen an der Domain (`APP_URL`). Bleibt die Cockpit-Domain gleich, funktionieren sie weiter.
- Ports ohne Adapter für das neue Ziel: zuerst den Adapter in `src/infra/<anbieter>/` bauen.
