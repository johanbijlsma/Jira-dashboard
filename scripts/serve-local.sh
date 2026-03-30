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

python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 &
api_pid=$!

npm --prefix dashboard run start -- -H 0.0.0.0 -p 3000 &
frontend_pid=$!

wait "$api_pid" "$frontend_pid"
