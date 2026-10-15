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
pnpm tokens:build        # regenerate src/styles/tokens.css from src/design/tokens.ts
pnpm cf:build            # OpenNext Cloudflare bundle; cf:preview / cf:deploy
```

Local Postgres: see `.env.example`. In a cloud container: `service postgresql start`, role
`aquisiteur/aquisiteur`, DBs `aquisiteur`, `aquisiteur_test`, `aquisiteur_e2e`. If Playwright's Chromium
revision is missing, set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium`.

## Architecture rules

- **Provider code only in `src/infra/`** behind the ports in `src/infra/types.ts`; feature code imports
  `@/infra` only. Enforced by ESLint (`eslint.config.mjs`) and `tests/unit/infra-boundary.test.ts`.
- **Workspace data only via `withTenant()`** (`src/db/client.ts`, or `ctx.tenant()` from
  `requireCockpit()`). The system connection (`getDb()` directly) is for auth, workspace creation, public
  host resolution and jobs. Never read tenant data with it in a request handler.
- **New table with workspace data** ⇒ `workspace_id uuid not null` + index + `workspaceIsolation()`
  policy + `.enableRLS()` in the Drizzle schema, a GRANT in a custom migration, and add it to
  `tenantTables` in `tests/db/tenant-isolation.test.ts` (a guard-rail test fails otherwise).
- Permissions via `can()` / `assertCan()` (`src/domain/authz.ts`); limits via `entitlements()`.
- Nothing workspace-specific in env or code: it belongs in `workspace_settings` (Zod schemas in
  `src/domain/workspace-settings.ts`).
- Pure logic in `src/domain` (unit-tested, no I/O). Server-only services in `src/server`.
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
