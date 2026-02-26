#!/usr/bin/env sh
set -eu

if [ $# -ne 1 ]; then
  echo "Usage: $0 <path-to-dump-file>" >&2
  exit 1
fi

dump_file="$1"
if [ ! -f "$dump_file" ]; then
  echo "Dump file not found: $dump_file" >&2
  exit 1
fi

required_vars="POSTGRES_HOST POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD"
for var in $required_vars; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

POSTGRES_PORT="${POSTGRES_PORT:-5432}"

echo "Restoring dump: $dump_file"
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$dump_file"

echo "Restore complete"
