#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${POSTGRES_PRISMA_DATABASE_URL:-}" ]]; then
  echo "POSTGRES_PRISMA_DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${POSTGRES_RESTORE_TEST_DATABASE_URL:-}" ]]; then
  echo "POSTGRES_RESTORE_TEST_DATABASE_URL is required" >&2
  exit 1
fi

case "$POSTGRES_PRISMA_DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Refusing to backup non-PostgreSQL URL" >&2; exit 1 ;;
esac

case "$POSTGRES_RESTORE_TEST_DATABASE_URL" in
  postgres://*|postgresql://*) ;;
  *) echo "Refusing to restore into non-PostgreSQL URL" >&2; exit 1 ;;
esac

strip_prisma_schema_param() {
  local url="$1"
  url="${url/\?schema=public/}"
  url="${url/&schema=public/}"
  printf '%s' "$url"
}

backup_database_url="$(strip_prisma_schema_param "$POSTGRES_PRISMA_DATABASE_URL")"
restore_database_url="$(strip_prisma_schema_param "$POSTGRES_RESTORE_TEST_DATABASE_URL")"

backup_file="${BACKUP_FILE:-/tmp/ast-postgres-backup.dump}"
rm -f "$backup_file"

pg_dump --format=custom --no-owner --no-privileges --file="$backup_file" "$backup_database_url"
pg_restore --clean --if-exists --no-owner --dbname="$restore_database_url" "$backup_file"

export POSTGRES_PRISMA_DATABASE_URL="$POSTGRES_RESTORE_TEST_DATABASE_URL"
pnpm postgres:schema-check

echo "backup_restore_check=PASS"