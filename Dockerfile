# App image, built by .github/workflows/image.yml and pulled by Docker Compose
# on the server (docs/DEPLOY.md, ADR-0053, ADR-0079). The Node major here is the
# one production runs; keep it in step with ci.yml and package.json engines.
FROM node:26-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Node 25+ no longer ships Corepack, so pnpm comes from npm (same version as packageManager).
RUN npm install -g pnpm@10.28.0 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Only the scheme matters at build time: it decides whether the HSTS header is
# baked into the routes (next.config.ts). Everything else is read at runtime.
ARG APP_URL=https://build.invalid
RUN APP_URL=$APP_URL PLATFORM_DOMAIN=build.invalid pnpm build
# The runtime needs neither dev tooling (Playwright, wrangler, eslint …) nor the
# build cache; dropping both shrinks the image from about 2.5 GB to well under 1 GB.
# Scripts that need sharp (expose:publish) run on the owner's machine instead.
RUN rm -rf .next/cache && CI=true pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# curl for the Compose health check (/healthz, deploy/compose.yml).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/files && chown node:node /data/files
# /data/files belongs to the app user, so a volume mounted there (STORAGE_PROVIDER=local) is writable.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Migrations first, so new code never runs against an old schema.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/next start"]
