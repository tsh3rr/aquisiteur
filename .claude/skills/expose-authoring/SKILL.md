---
name: expose-authoring
description: Write, validate and publish a personalised exposé (expose.json + assets) for a prospect. Use when the owner asks for a new exposé, a new example exposé, or changes to an existing one.
---

# Writing an exposé

The full format is in `docs/EXPOSE_AUTHORING.md`; read it first. The schema source of truth is
`src/domain/expose/schema.ts` (JSON Schema: `schema/expose.schema.json`).

1. Pick the closest example in `exposes/` as the starting point and the style by industry:
   `bold` (loud brands: fitness, barbershop, street food), `soft` (trust professions: practice, care,
   nursery), `editorial` (crafts, gastronomy).
2. Create `exposes/<slug>/expose.json` with `"$schema": "../../schema/expose.schema.json"` and put
   files under `exposes/<slug>/assets/`. Images at least 1600 px wide; the CLI scales them (never run
   `sharp` in app code). Videos need a `.vtt` caption file.
3. Copy is German, formal "Sie", concrete to the prospect's business (their name, location, the
   problems you saw on their current site). No invented facts, prices or testimonials about the prospect.
4. Every exposé needs a `contact` block (channel numbers come from the workspace settings) and
   usually a `cta` that jumps to it; chat button and nudges come from the renderer, don't hand-roll them.
5. `pnpm expose:validate exposes/<slug>` until it passes, then check it in the browser
   (`pnpm dev`, desktop and mobile width) and take screenshots for the owner into
   `/mnt/project-files/screenshots/<topic>/`.
6. Publish only when the owner asks: `pnpm expose:publish exposes/<slug>` (needs `AQUISITEUR_API_TOKEN`
   from Settings → API-Tokens).

A new example exposé that should ship with the repo also goes into the seed (`scripts/seed.ts`) and
must keep the Lighthouse job green.
