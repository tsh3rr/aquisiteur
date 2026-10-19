---
name: steward
description: Repo conventions for driving an Aquisiteur pull request to green - which CI job checks what, how to reproduce each one locally, and the known traps. Use when CI fails, a review arrives, or before pushing a PR.
---

# Driving an Aquisiteur PR to green

CI (`.github/workflows/ci.yml`) has five jobs. Reproduce a failure locally before pushing a fix.

| Job                           | Reproduce locally                                                     | Typical cause                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Lint, format, typecheck, unit | `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`       | import from `@/infra/*` outside infra, unformatted file, new env var missing in `.env.example` (`tests/unit/env-example.test.ts`) |
| Tenant isolation (Postgres)   | `pnpm test:db`                                                        | new workspace table not in `tenantTables`, missing GRANT migration                                                                |
| E2E + accessibility           | `pnpm test:e2e` (or one spec: `pnpm test:e2e tests/e2e/chat.spec.ts`) | axe violation, German copy changed but spec still expects the old text                                                            |
| Lighthouse                    | build + `pnpm start`, then `npx -y @lhci/cli@0.15.1 autorun`          | exposé client JS grew (TBT); see ADR-0048 and the CLAUDE.md working notes                                                         |
| Cloudflare bundle             | `pnpm cf:build` then the size step from `ci.yml`                      | a browser-only library leaked into the server bundle (ADR-0035, ADR-0037)                                                         |

Rules:

- `pnpm audit --prod --audit-level high` fails on new advisories in runtime deps. Upgrade the package; record an accepted advisory in `docs/SECURITY.md` only with a reason.
- E2E has `retries: 0` on purpose (shared DB). A red E2E is a real failure until a rerun on the same commit proves otherwise.
- Lighthouse is a median over 5 runs; one re-run is allowed to confirm a flake, a second red run is real.
- Schema change ⇒ `pnpm db:generate`, never hand-edit generated migrations or `drizzle/meta/`. Exposé schema change ⇒ `pnpm expose:schema`. Token change ⇒ `pnpm tokens:build`. Commit the generated files.
- Branch convention: one feature per branch; after a merge restart the branch from `origin/main` and merge (not rebase) `main` into a PR branch someone else owns.
- New screens get an `expectAccessible` check; attach screenshots of UI changes to the PR and to `/mnt/project-files/screenshots/<topic>/`.
- Optional review findings (nits) ride the next code push; they never start one on their own.
