#!/bin/bash
# PostToolUse hook: formats the file Claude just edited with the repo's Prettier config,
# so `pnpm format:check` in CI never fails on formatting. Silent; never blocks the edit.
set -uo pipefail

file=$(jq -r '.tool_input.file_path // empty')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

case "$file" in
  "$root"/*) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] && [ -x "$root/node_modules/.bin/prettier" ] || exit 0

cd "$root" && node_modules/.bin/prettier --write --ignore-unknown --log-level silent "$file" || true
