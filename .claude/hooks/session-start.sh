#!/bin/bash
# Prepares a Claude Code cloud session so lint, typecheck, unit, DB and E2E tests
# run right away: dependencies, local Postgres with the three databases, and a .env.
# Local machines are left alone. The role is a superuser, as in CI (migrations create roles).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

pnpm install --prefer-offline >/dev/null

if command -v service >/dev/null && [ -d /usr/lib/postgresql ]; then
  service postgresql start >/dev/null
  for _ in $(seq 1 20); do
    pg_isready -q && break
    sleep 1
  done
  psql_admin() { su postgres -c "psql -v ON_ERROR_STOP=1 -qAt $*"; }
  if [ "$(psql_admin "-c \"select 1 from pg_roles where rolname = 'aquisiteur'\"")" != "1" ]; then
    psql_admin "-c \"create role aquisiteur login superuser password 'aquisiteur'\""
  fi
  for db in aquisiteur aquisiteur_test aquisiteur_e2e; do
    if [ "$(psql_admin "-c \"select 1 from pg_database where datname = '$db'\"")" != "1" ]; then
      psql_admin "-c \"create database $db owner aquisiteur\""
    fi
  done
fi

[ -f .env ] || cp .env.example .env

if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium' >>"$CLAUDE_ENV_FILE"
fi
