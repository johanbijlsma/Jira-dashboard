#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

api_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if ! command -v python3 >/dev/null 2>&1; then
  echo "Missing required command: python3" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Missing required command: npm" >&2
  exit 1
fi

if [[ ! -x dashboard/node_modules/.bin/next ]]; then
  npm --prefix dashboard ci
fi

echo "Starting local dashboard with Teams alerts disabled..."

ALERT_TEAMS_NOTIFICATIONS_ENABLED="false" \
  python3 -m uvicorn api:app --host 127.0.0.1 --port 8000 &
api_pid=$!

npm --prefix dashboard run dev -- -H 127.0.0.1 -p 3000 &
frontend_pid=$!

echo
echo "Dashboard: http://127.0.0.1:3000"
echo "API: http://127.0.0.1:8000/status"
echo "Auto-sync: enabled (follows your current environment/config)"
echo "Teams alerts: disabled"
echo
echo "Gebruik handmatige sync vanuit de statuspagina of via 'make sync'."
echo "Press Ctrl+C to stop the local servers."

wait "$api_pid" "$frontend_pid"
