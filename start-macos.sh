#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

command -v node >/dev/null || { echo 'Install Node.js 20+ first.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'Install npm first.' >&2; exit 1; }
[[ -f .env ]] || { echo 'Missing .env. Run: npm run gen-env' >&2; exit 1; }

setting() { sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | tr -d '"'; }
VNC_HOST="$(setting VNC_HOST)"; VNC_HOST="${VNC_HOST:-127.0.0.1}"
VNC_PORT="$(setting VNC_PORT)"; VNC_PORT="${VNC_PORT:-5900}"
PORT="$(setting PORT)"; PORT="${PORT:-3100}"

if ! nc -z -G 3 "$VNC_HOST" "$VNC_PORT"; then
  echo "No VNC server at ${VNC_HOST}:${VNC_PORT}. Enable Screen Sharing in System Settings > General > Sharing and configure a VNC password." >&2
  exit 1
fi

[[ -d node_modules ]] || npm install
[[ -f .next/BUILD_ID ]] || npm run build

echo "Open http://127.0.0.1:${PORT}/login (Ctrl+C to stop web app)."
exec npm start
