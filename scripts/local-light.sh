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

AUTO_SYNC_ENABLED="false" \
WEEKLY_INSIGHTS_ENABLED="false" \
ALERT_TEAMS_NOTIFICATIONS_ENABLED="false" \
python3 -m uvicorn api:app --host 127.0.0.1 --port 8000 --loop asyncio &
api_pid=$!

npm --prefix dashboard run start -- -H 127.0.0.1 -p 3000 &
frontend_pid=$!

echo
echo "Lichte lokale modus gestart."
echo "Dashboard: http://127.0.0.1:3000"
echo "Automatische Jira-sync, Weekly Insights en Teams-alerts staan uit."
echo "Gebruik de statuspagina of 'make sync' voor een handmatige synchronisatie."
echo "Druk op Ctrl+C om beide servers te stoppen."

wait "$api_pid" "$frontend_pid"
