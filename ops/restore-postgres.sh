#!/usr/bin/env bash
set -Eeuo pipefail

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
: "${QUIZIJIE_RESTORE_FILE:?set QUIZIJIE_RESTORE_FILE}"
: "${QUIZIJIE_ALLOW_RESTORE:?set QUIZIJIE_ALLOW_RESTORE=YES after reviewing the target}"

if [[ "$QUIZIJIE_ALLOW_RESTORE" != "YES" ]]; then
  echo "Restore refused: QUIZIJIE_ALLOW_RESTORE must equal YES" >&2
  exit 1
fi
if [[ ! -f "$QUIZIJIE_RESTORE_FILE" ]]; then
  echo "Restore file does not exist" >&2
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
: "${DATABASE_URL:?environment file is missing DATABASE_URL}"

pg_restore --list "$QUIZIJIE_RESTORE_FILE" >/dev/null
PGDATABASE="$DATABASE_URL" pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "$QUIZIJIE_RESTORE_FILE"

echo "Database restore completed for target environment: $target_environment"
