#!/usr/bin/env sh
set -eu

required_vars="POSTGRES_HOST POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD"
for var in $required_vars; do
  eval "value=\${$var:-}"
  if [ -z "$value" ]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

dump_file="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.dump"
echo "Creating backup: $dump_file"

PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -Fc \
  -f "$dump_file"

find "$BACKUP_DIR" -type f -name "*.dump" -mtime "+$RETENTION_DAYS" -delete

echo "Backup complete"
