#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
: "${QUIZIJIE_API_IMAGE:?set QUIZIJIE_API_IMAGE}"
: "${QUIZIJIE_MIGRATE_IMAGE:?set QUIZIJIE_MIGRATE_IMAGE}"

api_port="${QUIZIJIE_API_PORT:-3000}"
import_questions="${QUIZIJIE_IMPORT_QUESTIONS:-false}"
state_dir="${QUIZIJIE_RELEASE_STATE_DIR:-$root_dir/.release}"
compose=(docker compose -f compose.release.yaml)

node tools/check-deployment-env.js "$QUIZIJIE_API_ENV_FILE"
mkdir -p "$state_dir"

if [[ -f "$state_dir/current.env" ]]; then
  cp "$state_dir/current.env" "$state_dir/previous.env"
fi

"${compose[@]}" pull api migrate
"${compose[@]}" --profile tools run --rm migrate

if [[ "$import_questions" == "true" ]]; then
  "${compose[@]}" --profile tools run --rm migrate npm run db:seed:compiled --workspace server
fi

"${compose[@]}" up -d --no-build --remove-orphans api

ready=0
for _ in $(seq 1 45); do
  if curl --silent --fail "http://127.0.0.1:${api_port}/ready" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != "1" ]]; then
  "${compose[@]}" ps
  "${compose[@]}" logs --tail 100 api
  echo "API readiness check failed" >&2
  exit 1
fi

cat > "$state_dir/current.env" <<EOF
QUIZIJIE_API_IMAGE=$QUIZIJIE_API_IMAGE
QUIZIJIE_MIGRATE_IMAGE=$QUIZIJIE_MIGRATE_IMAGE
QUIZIJIE_API_PORT=$api_port
EOF
chmod 600 "$state_dir/current.env"

echo "Release completed and readiness passed."
