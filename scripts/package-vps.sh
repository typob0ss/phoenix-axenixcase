#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
archive="${1:-output/vps/phoenix-release.tar.gz}"
if [ ! -f dist/index.html ]; then
  echo 'Сначала выполните scripts/pnpm.sh build.' >&2
  exit 1
fi
mkdir -p "$(dirname "$archive")"
# Explicit allowlist: configuration secrets, Git history and QA outputs stay local.
COPYFILE_DISABLE=1 tar --exclude='__pycache__' --exclude='*.pyc' \
  -czf "$archive" backend dist public/fonts requirements.lock.txt
printf 'Архив для VPS: %s\n' "$archive"
