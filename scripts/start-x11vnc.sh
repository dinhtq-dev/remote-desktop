#!/usr/bin/env bash
set -euo pipefail

DISPLAY_NUM="${DISPLAY:-:0}"
VNC_PORT="${VNC_PORT:-5900}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${ROOT}/.runtime"
mkdir -p "${LOG_DIR}"

AUTH_FILE="${XAUTHORITY:-}"
if [[ -z "${AUTH_FILE}" && -f "${HOME}/.Xauthority" ]]; then
  AUTH_FILE="${HOME}/.Xauthority"
fi

ARGS=(
  -display "${DISPLAY_NUM}"
  -localhost
  -rfbport "${VNC_PORT}"
  -forever
  -shared
  -nopw
  -xkb
  -repeat
  -defer 5
  -wait 10
  -o "${LOG_DIR}/x11vnc.log"
)

CLIP_FILE="${LOG_DIR}/vnc-clip"
if [[ -f "${CLIP_FILE}" ]]; then
  CLIP="$(tr -d '[:space:]' <"${CLIP_FILE}" || true)"
  if [[ -n "${CLIP}" ]]; then
    ARGS+=(-clip "${CLIP}")
  fi
fi

if [[ -n "${AUTH_FILE}" && -f "${AUTH_FILE}" ]]; then
  ARGS+=(-auth "${AUTH_FILE}")
else
  ARGS+=(-auth guess)
fi

exec x11vnc "${ARGS[@]}"
