#!/usr/bin/env bash
set -euo pipefail

WEBSOCKIFY_HOST="${WEBSOCKIFY_HOST:-127.0.0.1}"
WEBSOCKIFY_PORT="${WEBSOCKIFY_PORT:-6080}"
VNC_HOST="${VNC_HOST:-127.0.0.1}"
VNC_PORT="${VNC_PORT:-5900}"

if command -v websockify >/dev/null 2>&1; then
  exec websockify "${WEBSOCKIFY_HOST}:${WEBSOCKIFY_PORT}" "${VNC_HOST}:${VNC_PORT}"
fi

# Fallback: python module
exec python3 -m websockify "${WEBSOCKIFY_HOST}:${WEBSOCKIFY_PORT}" "${VNC_HOST}:${VNC_PORT}"
