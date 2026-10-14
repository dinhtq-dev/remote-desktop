#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT}/.runtime"
mkdir -p "${LOG_DIR}"

# Stop only our x11vnc (localhost :5900), keep websockify/web.
pkill -f "x11vnc .* -rfbport ${VNC_PORT:-5900}" 2>/dev/null || true
sleep 0.4

nohup "${ROOT}/scripts/start-x11vnc.sh" >>"${LOG_DIR}/x11vnc.out" 2>&1 &
echo $! >"${LOG_DIR}/x11vnc.pid"
sleep 0.6

if ! ss -ltn | grep -q "127.0.0.1:${VNC_PORT:-5900}"; then
  echo "x11vnc failed to bind 127.0.0.1:${VNC_PORT:-5900}" >&2
  tail -n 40 "${LOG_DIR}/x11vnc.log" 2>/dev/null || true
  exit 1
fi

echo "x11vnc restarted (clip=$(tr -d '\n' <"${LOG_DIR}/vnc-clip" 2>/dev/null || true))"
