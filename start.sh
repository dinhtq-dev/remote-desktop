#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

mkdir -p .runtime

if [[ ! -f .env ]]; then
  echo "Missing .env — copy .env.example or run: pnpm gen-env"
  exit 1
fi

# Load simple KEY=VALUE lines for port checks (ignore comments/blank)
set -a
# shellcheck disable=SC1091
source <(grep -E '^[A-Z0-9_]+=' .env | sed 's/\r$//')
set +a

PORT="${PORT:-3100}"
VNC_PORT="${VNC_PORT:-5900}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing command: $1"
    exit 1
  }
}

need_cmd x11vnc
need_cmd pnpm
need_cmd node

if [[ ! -f .next/BUILD_ID ]]; then
  echo "No production build — running pnpm build..."
  pnpm build
fi

pids=()

cleanup() {
  echo
  echo "Stopping..."
  for pid in "${pids[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting x11vnc on 127.0.0.1:${VNC_PORT}..."
./scripts/start-x11vnc.sh >>.runtime/x11vnc.out 2>&1 &
pids+=($!)

sleep 1

echo "Starting web on http://127.0.0.1:${PORT} ..."
node server.mjs --production &
pids+=($!)

echo "OK — login at http://127.0.0.1:${PORT}/login (or https://remote.dinhtq.vn/login via tunnel)"
echo "Ctrl+C to stop all."

wait
