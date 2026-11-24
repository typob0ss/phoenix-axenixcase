#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo 'Сначала установите Python-зависимости по инструкции README.md.' >&2
  exit 1
fi
if [ ! -f dist/index.html ]; then
  if [ ! -x node_modules/.bin/vite ] || [ ! -x node_modules/.bin/tsc ]; then
    echo 'Сначала установите frontend-зависимости: scripts/pnpm.sh install --frozen-lockfile' >&2
    exit 1
  fi
  scripts/pnpm.sh build
fi
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port "${PORT:-8000}"
