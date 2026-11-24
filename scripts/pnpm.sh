#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
CODEX_NODE_DIR="/Users/rogacevkirill/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [ -x "$CODEX_NODE_DIR/node" ]; then
  # The app's hardened Node cannot load third-party native Rollup modules.
  PATH="$CODEX_NODE_DIR:$PATH"
  export PATH
fi
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm "$@"
fi
if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm "$@"
fi
CODEX_PNPM="/Users/rogacevkirill/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs"
if [ -f "$CODEX_PNPM" ]; then
  exec node "$CODEX_PNPM" "$@"
fi
echo 'Не найден pnpm. Установите pnpm или включите Corepack.' >&2
exit 1
