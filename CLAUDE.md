# CLAUDE.md

Aquisiteur: letter-based client acquisition for a small web agency. Hosts personalised exposés, tracks
interactions cookieless, nudges contact, notifies the owner. **The binding spec is `ZIELPROMPT.md`**; on
conflicts it wins. Requirement changes go there.

- Talk to the owner in **German**. Code, comments, commit messages in **English**. UI copy in German (formal "Sie").
- Work in the phases of `docs/ROADMAP.md`. A phase is done only when lint, typecheck, unit, DB and E2E tests are green.
- Record every relevant decision as a short ADR in `docs/DECISIONS.md`.

## Commands

```bash
pnpm dev                 # next dev on http://localhost:3000 (magic links are printed to this log)
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test                # unit tests (Vitest, no DB)
pnpm test:db             # DB tests against TEST_DATABASE_URL (wiped each run)
pnpm test:e2e            # Playwright + axe; builds, starts on :3100, uses aquisiteur_e2e DB
pnpm db:generate         # drizzle-kit migration from schema changes
pnpm db:migrate | db:seed | db:reset
pnpm user:login <email>   # create account + print one-time sign-in link (no mail needed)
pnpm expose:validate <dir> | expose:publish <dir>   # exposé CLI (docs/EXPOSE_AUTHORING.md)
pnpm expose:schema       # regenerate schema/expose.schema.json after changing src/domain/expose/schema.ts
pnpm tokens:build        # regenerate src/styles/tokens.css from src/design/tokens.ts
pnpm push:keys           # VAPID key pair for Web Push; pnpm jobs:hourly calls /api/jobs/hourly
pnpm cf:build            # OpenNext Cloudflare bundle; cf:preview / cf:deploy
pnpm cf:release          # migrate + deploy (Workers Builds deploy command, ADR-0036)
pnpm deploy:secrets      # print fresh secrets + VAPID pair for the dashboard
```

Local Postgres: see `.env.example`. Cloud sessions are prepared by `.claude/hooks/session-start.sh`
(deps, Postgres with role `aquisiteur/aquisiteur` and DBs `aquisiteur`, `aquisiteur_test`, `aquisiteur_e2e`,
`.env`, `PLAYWRIGHT_CHROMIUM_PATH`), so tests run without setup. Edited files are auto-formatted by a hook.

## How to work

- Multi-file or unclear change: read the relevant spec section and code first, write a short plan, then
  build. A one-sentence diff needs no plan.
- Done means verified: run the checks that cover the change (single test files while iterating, the full
  set before the PR) and report the commands and results, plus screenshots for UI. Before opening a PR
  for a feature, let the `spec-reviewer` agent check the diff and fix what it finds.
- Skills: `steward` (CI and PR conventions), `expose-authoring` (new exposés), `backlog` (owner requests
  for later).
- When compacting, keep the list of changed files, the commands that verify them, and open owner questions.

## Architecture rules

- **Provider code only in `src/infra/`** behind the ports in `src/infra/types.ts`; feature code imports
  `@/infra` only. Enforced by ESLint (`eslint.config.mjs`) and `tests/unit/infra-boundary.test.ts`.
- **Workspace data only via `withTenant()`** (`src/db/client.ts`, or `ctx.tenant()` from
  `requireCockpit()`). The system connection (`getDb()` directly) is for auth, workspace creation, public
  host resolution and jobs. Never read tenant data with it in a request handler.
- **New table with workspace data** ⇒ `workspace_id uuid not null` + index + `workspaceIsolation()`
  policy + `.enableRLS()` in the Drizzle schema, a GRANT in a custom migration, and add it to
  `tenantTables` in `tests/db/tenant-isolation.test.ts` (a guard-rail test fails otherwise).
- Public tracking (`src/server/tracking/visits.ts`, routes under `src/app/sites/[host]/`) runs on the
  system connection and must scope every query to the host's workspace; tenants only read `visits` and
  `events`. Event types live in `src/domain/tracking/events.ts` (one central list).
- Realtime: write through app routes/actions, then `publish()` (`src/server/realtime.ts`); browsers only
  listen via `@/infra/realtime-client` (the one `@/infra/*` import allowed outside infra, ADR-0020).
- Permissions via `can()` / `assertCan()` (`src/domain/authz.ts`); limits via `entitlements()`.
- Intent and notifications: after a signal, `defer(() => processProspect(...))`
  (`src/server/intent/process.ts`) recomputes `intent_scores` and runs the rules; never notify
  inline in a response. Scoring and rule logic stay pure in `src/domain/intent` and
  `src/domain/notifications.ts`. Timed work goes into `/api/jobs/hourly` (ADR-0032).
- Nothing workspace-specific in env or code: it belongs in `workspace_settings` (Zod schemas in
  `src/domain/workspace-settings.ts`).
- Files go through `getInfra().storage` (keys always start with `<workspace_id>/`); `sharp` only in
  `scripts/` (Workers cannot run it), so images arrive pre-scaled (ADR-0013).
- Public workspace pages read via the system connection but always scoped to the host's workspace
  (ADR-0012).
- Pure logic in `src/domain` (unit-tested, no I/O). Server-only services in `src/server`.
- Browser-only libraries (react-pdf, Leaflet, rrweb) load via dynamic `import()` on the client and are
  aliased out of the server bundle in `next.config.ts`; keep it that way or the Worker outgrows the free
  plan (ADR-0035, ADR-0037). The CI job "Cloudflare bundle" warns above 2900 KiB and fails above
  9800 KiB (paid plan, ADR-0068); stay under the warning where it is cheap.
- Bodies from outside (public routes, API) are read with `readBodyLimited` / `readTextLimited`
  (`src/lib/body.ts`), never `request.json()` unbounded. Security checklist: `docs/SECURITY.md`.
- Host routing: `src/middleware.ts` (Edge; see ADR-0006). Public workspace pages live under
  `src/app/sites/[host]/`.

## UI rules

- WCAG 2.2 AA is mandatory: semantic HTML, labels via `<Field>`, visible focus, ≥ 44 px touch targets,
  status never by colour alone, `aria-live` for async messages. Every new screen gets an `expectAccessible`
  check in an E2E spec.
- Colours/radii/motion only from tokens (`src/design/tokens.ts` → Tailwind classes like `bg-surface`,
  `text-foreground-muted`, `bg-accent`). Add new colour pairs to `contrastPairs`.
- Skeletons instead of spinners, empty states with a clear next action, respect `prefers-reduced-motion`.

## Migrations

`drizzle/0000` (roles, helper functions) and `drizzle/0002` (grants) are hand-written
(`drizzle-kit generate --custom`). Everything else is generated from `src/db/schema`. Plain Postgres
only (portable via `pg_dump`). Migrations must keep the previous app version working.

## Working notes (for new threads)

- As of 2026-10-21 the owner runs Docker Compose on Mikrus behind Mikrus' own HTTPS proxy, **without
  Coolify and without an own Cloudflare** (`docs/DEPLOY_COMPOSE.md`, ADR-0054). Client IPs come only
  from `x-aquisiteur-client-ip`, set by the middleware (ADR-0064); never read `cf-*` or
  `x-forwarded-for` elsewhere.
- The planned production setup is a Mikrus 3.5 with Coolify behind Cloudflare (`HOSTING_PROFILE=node`, ADR-0047,
  ADR-0052): IPv6 only, so Cloudflare proxies every domain; files and DB backups live in R2
  (`STORAGE_PROVIDER=s3`), mail via Resend. Cloudflare stays a buildable fallback, so the CI bundle job
  must stay green. `docs/DEPLOY.md` is the runbook.
- One feature per branch and PR; after a merge, restart the working branch from `origin/main`.
  Screenshots for the owner go to `/mnt/project-files/screenshots/<topic>/`.
- Lighthouse CI (median ≥ 0.9 over 5 runs on two exposés) is TBT-bound. Keep exposé client code lean:
  no `next/link` in the root `not-found`, no `Intl.NumberFormat` (use `formatEuro`), no tailwind-merge
  in idle-loaded exposé code (`clsx` instead, avoid conflicting classes) (ADR-0048). E2E asserts no
  cockpit chunk loads on an exposé.
- New notification trigger default ⇒ add it to `DEFAULT_RULES` **and** backfill existing workspaces in
  a custom migration (see `drizzle/0015_callback_rule.sql`).
- The Chat nav badge counts unread threads plus open callbacks (`chatInboxCount`); keep it in sync via
  `UNREAD_EVENT` after mutating either.
- Backlog with owner requests lives in ZIELPROMPT §7 and `docs/ROADMAP.md` "Später" (skill `backlog`).
