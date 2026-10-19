Before:

After:

<!-- One sentence on what the change does, if it is not obvious. -->

How:

## Verification

- [ ] `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`
- [ ] `pnpm test:db` (schema, tenant data or tracking touched)
- [ ] `pnpm test:e2e` (UI or a user flow touched; new screens have `expectAccessible`)
- [ ] Screenshots attached (UI changes, desktop and mobile)
- [ ] ADR in `docs/DECISIONS.md`, spec in `ZIELPROMPT.md`, `docs/ROADMAP.md` updated where needed
