#!/usr/bin/env bash
set -Eeuo pipefail

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
: "${QUIZIJIE_RESTORE_FILE:?set QUIZIJIE_RESTORE_FILE}"
: "${QUIZIJIE_RESTORE_DATABASE:?set QUIZIJIE_RESTORE_DATABASE to the exact target database}"
: "${QUIZIJIE_RESTORE_DATABASE_CONFIRM:?repeat the target database in QUIZIJIE_RESTORE_DATABASE_CONFIRM}"
: "${QUIZIJIE_ALLOW_RESTORE:?set QUIZIJIE_ALLOW_RESTORE=YES after reviewing the target}"
: "${QUIZIJIE_ALLOW_DATABASE_REPLACE:?set QUIZIJIE_ALLOW_DATABASE_REPLACE=YES after approving destructive replacement}"

if [[ "$QUIZIJIE_ALLOW_RESTORE" != "YES" || "$QUIZIJIE_ALLOW_DATABASE_REPLACE" != "YES" ]]; then
  echo "Restore refused: both restore confirmations must equal YES" >&2
  exit 1
fi
if [[ "$QUIZIJIE_RESTORE_DATABASE_CONFIRM" != "$QUIZIJIE_RESTORE_DATABASE" ]]; then
  echo "Restore refused: target database confirmation does not match" >&2
  exit 1
fi
if [[ ! -f "$QUIZIJIE_RESTORE_FILE" ]]; then
  echo "Restore file does not exist" >&2
  exit 1
fi
if [[ ! -f "$QUIZIJIE_API_ENV_FILE" ]]; then
  echo "Environment file does not exist" >&2
  exit 1
fi

target_environment="${QUIZIJIE_TARGET_ENVIRONMENT:-staging}"
if [[ "$target_environment" == "production" && "${QUIZIJIE_ALLOW_PRODUCTION_RESTORE:-}" != "YES" ]]; then
  echo "Production restore refused without QUIZIJIE_ALLOW_PRODUCTION_RESTORE=YES" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$QUIZIJIE_API_ENV_FILE"
set +a

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ops/lib/mysql-client.sh
source "$script_dir/lib/mysql-client.sh"
command -v mysql >/dev/null 2>&1 || { echo "mysql client is required" >&2; exit 1; }
command -v gzip >/dev/null 2>&1 || { echo "gzip is required" >&2; exit 1; }

source_defaults_file="$(mktemp "${TMPDIR:-/tmp}/quzijie-mysql-source.XXXXXX.cnf")"
target_defaults_file="$(mktemp "${TMPDIR:-/tmp}/quzijie-mysql-target.XXXXXX.cnf")"
cleanup() {
  rm -f -- "$source_defaults_file" "$target_defaults_file"
}
trap cleanup EXIT

create_mysql_client_defaults "$source_defaults_file"
configured_database="$QUIZIJIE_MYSQL_DATABASE"
if [[ "$QUIZIJIE_RESTORE_DATABASE" == "$configured_database" && "$target_environment" != "production" ]]; then
  echo "Restore refused: the configured live database may only be targeted with production confirmations" >&2
  exit 1
fi
create_mysql_client_defaults "$target_defaults_file" "$QUIZIJIE_RESTORE_DATABASE"
target_database="$QUIZIJIE_MYSQL_DATABASE"

gzip -t "$QUIZIJIE_RESTORE_FILE"
mysql --defaults-extra-file="$target_defaults_file" \
  --batch \
  --skip-column-names \
  --execute="DROP DATABASE IF EXISTS \`$target_database\`; CREATE DATABASE \`$target_database\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gzip -dc "$QUIZIJIE_RESTORE_FILE" | mysql --defaults-extra-file="$target_defaults_file" \
  --binary-mode=1 \
  --default-character-set=utf8mb4 \
  "$target_database"

echo "MySQL restore completed for $target_environment target: $target_database"
