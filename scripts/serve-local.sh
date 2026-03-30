#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

api_pid=""
frontend_pid=""
funnel_enabled="false"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prompt_if_missing() {
  local var_name="$1"
  local prompt_text="$2"
  local silent="${3:-false}"
  local current="${!var_name:-}"
  if [[ -n "$current" ]]; then
    return
  fi

  if [[ "$silent" == "true" ]]; then
    read -r -s -p "$prompt_text: " current
    echo
  else
    read -r -p "$prompt_text: " current
  fi
  export "$var_name=$current"
}

cleanup() {
  if [[ "$funnel_enabled" == "true" ]]; then
    tailscale funnel 3000 off >/dev/null 2>&1 || true
  fi
  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_command python3
require_command npm
require_command tailscale

prompt_if_missing "DASHBOARD_BASIC_AUTH_USER" "Dashboard username"
prompt_if_missing "DASHBOARD_BASIC_AUTH_PASSWORD" "Dashboard password" "true"

python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 &
api_pid=$!

npm --prefix dashboard run start -- -H 0.0.0.0 -p 3000 &
frontend_pid=$!

sleep 2

tailscale funnel --bg --yes 3000 >/dev/null
funnel_enabled="true"

echo "Local dashboard is running."
echo "Basic Auth user: ${DASHBOARD_BASIC_AUTH_USER}"
echo "Funnel status:"
tailscale funnel status
echo
echo "Press Ctrl+C to stop the local servers and disable Funnel."

wait "$api_pid" "$frontend_pid"
