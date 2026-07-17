#!/usr/bin/env bash
set -Eeuo pipefail

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
backup_dir="${QUIZIJIE_BACKUP_DIR:-./backups}"
retention_days="${QUIZIJIE_BACKUP_RETENTION_DAYS:-14}"

if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || [[ "$retention_days" -lt 1 ]]; then
  echo "QUIZIJIE_BACKUP_RETENTION_DAYS must be a positive integer" >&2
  exit 1
fi
if [[ ! -f "$QUIZIJIE_API_ENV_FILE" ]]; then
  echo "Environment file does not exist" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$QUIZIJIE_API_ENV_FILE"
set +a

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib/mysql-client.sh
source "$script_dir/lib/mysql-client.sh"
command -v mysqldump >/dev/null 2>&1 || { echo "mysqldump is required" >&2; exit 1; }
command -v gzip >/dev/null 2>&1 || { echo "gzip is required" >&2; exit 1; }

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
defaults_file="$(mktemp "${TMPDIR:-/tmp}/quzijie-mysql.XXXXXX.cnf")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
sql_path="$backup_dir/.quzijie-$timestamp.sql.partial"
partial_path="$backup_dir/quzijie-$timestamp.sql.gz.partial"
final_path="$backup_dir/quzijie-$timestamp.sql.gz"

cleanup() {
  rm -f -- "$defaults_file" "$sql_path" "$partial_path"
}
trap cleanup EXIT

create_mysql_client_defaults "$defaults_file"
mysqldump --defaults-extra-file="$defaults_file" \
  --single-transaction \
  --quick \
  --routines \
  --events \
  --triggers \
  --hex-blob \
  --default-character-set=utf8mb4 \
  --set-gtid-purged=OFF \
  --no-tablespaces \
  "$QUIZIJIE_MYSQL_DATABASE" > "$sql_path"

if ! grep -Eq '^-- (MySQL|MariaDB) dump' "$sql_path" \
  || ! tail -n 30 "$sql_path" | grep -q '^-- Dump completed on'; then
  echo "mysqldump output is incomplete" >&2
  exit 1
fi
gzip -9 -c "$sql_path" > "$partial_path"
gzip -t "$partial_path"
chmod 600 "$partial_path"
mv "$partial_path" "$final_path"

find "$backup_dir" -maxdepth 1 -type f -name 'quzijie-*.sql.gz' -mtime "+$retention_days" -delete
echo "MySQL backup verified: $final_path"
