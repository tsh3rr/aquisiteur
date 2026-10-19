# App image for servers too small to build on (ADR-0053). Built by
# .github/workflows/image.yml and pulled by Coolify; Nixpacks stays the
# alternative for servers with enough memory (nixpacks.toml).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_HOME=/corepack NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Only the scheme matters at build time: it decides whether the HSTS header is
# baked into the routes (next.config.ts). Everything else is read at runtime.
ARG APP_URL=https://build.invalid
RUN APP_URL=$APP_URL PLATFORM_DOMAIN=build.invalid pnpm build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# curl for Coolify's health check (/healthz).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* && chmod -R a+rX /corepack \
  && mkdir -p /data/files && chown node:node /data/files
# /data/files belongs to the app user, so a volume mounted there (STORAGE_PROVIDER=local) is writable.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
# Migrations first, so new code never runs against an old schema (as in nixpacks.toml).
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/next start"]
