#!/usr/bin/env bash
set -Eeuo pipefail

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
backup_dir="${QUIZIJIE_BACKUP_DIR:-./backups}"
retention_days="${QUIZIJIE_BACKUP_RETENTION_DAYS:-14}"

if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || [[ "$retention_days" -lt 1 ]]; then
  echo "QUIZIJIE_BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$QUIZIJIE_API_ENV_FILE"
set +a
: "${DATABASE_URL:?environment file is missing DATABASE_URL}"

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_path="$backup_dir/quzijie-$timestamp.dump"
temporary_path="$final_path.partial"

PGDATABASE="$DATABASE_URL" pg_dump --format=custom --compress=9 --no-owner --no-privileges --file "$temporary_path"
pg_restore --list "$temporary_path" >/dev/null
chmod 600 "$temporary_path"
mv "$temporary_path" "$final_path"

find "$backup_dir" -maxdepth 1 -type f -name 'quzijie-*.dump' -mtime "+$retention_days" -delete
echo "Database backup verified: $final_path"
