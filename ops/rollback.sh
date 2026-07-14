#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
state_dir="${QUIZIJIE_RELEASE_STATE_DIR:-$root_dir/.release}"
previous="$state_dir/previous.env"

if [[ ! -f "$previous" ]]; then
  echo "No previous release state exists at $previous" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$previous"
set +a

: "${QUIZIJIE_API_IMAGE:?previous release is missing QUIZIJIE_API_IMAGE}"
: "${QUIZIJIE_MIGRATE_IMAGE:?previous release is missing QUIZIJIE_MIGRATE_IMAGE}"

api_port="${QUIZIJIE_API_PORT:-3000}"
pull_images="${QUIZIJIE_PULL_IMAGES:-true}"
compose=(docker compose -f compose.release.yaml)
if [[ -n "${QUIZIJIE_COMPOSE_OVERRIDE_FILE:-}" ]]; then
  if [[ ! -f "$QUIZIJIE_COMPOSE_OVERRIDE_FILE" ]]; then
    echo "Compose override does not exist: $QUIZIJIE_COMPOSE_OVERRIDE_FILE" >&2
    exit 1
  fi
  compose+=(-f "$QUIZIJIE_COMPOSE_OVERRIDE_FILE")
fi

if [[ "$pull_images" != "true" && "$pull_images" != "false" ]]; then
  echo "QUIZIJIE_PULL_IMAGES must equal true or false" >&2
  exit 1
fi
if [[ "$pull_images" == "true" ]]; then
  "${compose[@]}" pull api
fi
"${compose[@]}" up -d --no-build api

ready=0
for _ in $(seq 1 45); do
  if curl --silent --fail "http://127.0.0.1:${api_port}/ready" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  "${compose[@]}" logs --tail 100 api
  echo "Rollback image failed readiness check" >&2
  exit 1
fi

cp "$previous" "$state_dir/current.env"
chmod 600 "$state_dir/current.env"
echo "Application image rollback completed. Database schema was not rolled back."
