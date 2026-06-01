#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p storage/logs
touch /tmp/jira-dashboard-serve.log /tmp/jira-dashboard-vite.log storage/logs/sync-run.log storage/logs/laravel.log
touch /tmp/jira-dashboard-schedule.log

php artisan serve > /tmp/jira-dashboard-serve.log 2>&1 &
SERVE_PID=$!

npm run dev > /tmp/jira-dashboard-vite.log 2>&1 &
VITE_PID=$!

php artisan schedule:work > /tmp/jira-dashboard-schedule.log 2>&1 &
SCHEDULE_PID=$!

tail -n 0 -F /tmp/jira-dashboard-serve.log | sed -u 's/^/[serve] /' &
TAIL_SERVE_PID=$!

tail -n 0 -F /tmp/jira-dashboard-vite.log | sed -u 's/^/[vite] /' &
TAIL_VITE_PID=$!

tail -n 0 -F /tmp/jira-dashboard-schedule.log | sed -u 's/^/[schedule] /' &
TAIL_SCHEDULE_PID=$!

tail -n 0 -F storage/logs/sync-run.log | sed -u 's/^/[sync] /' &
TAIL_SYNC_PID=$!

tail -n 0 -F storage/logs/laravel.log | sed -u 's/^/[laravel] /' &
TAIL_LARAVEL_PID=$!

cleanup() {
  kill "$SERVE_PID" "$VITE_PID" "$SCHEDULE_PID" "$TAIL_SERVE_PID" "$TAIL_VITE_PID" "$TAIL_SCHEDULE_PID" "$TAIL_SYNC_PID" "$TAIL_LARAVEL_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

printf 'Laravel server draait op http://127.0.0.1:8000\n'
printf 'Vite dev server draait via npm\n'
printf 'Laravel scheduler draait via schedule:work\n'
printf 'Live logs zichtbaar: [serve], [vite], [schedule], [sync], [laravel]\n'

wait "$SERVE_PID" "$VITE_PID" "$SCHEDULE_PID"
