#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

: "${QUIZIJIE_API_ENV_FILE:?set QUIZIJIE_API_ENV_FILE}"
: "${QUIZIJIE_API_IMAGE:?set QUIZIJIE_API_IMAGE}"
: "${QUIZIJIE_MIGRATE_IMAGE:?set QUIZIJIE_MIGRATE_IMAGE}"

api_port="${QUIZIJIE_API_PORT:-3000}"
bootstrap_empty_baseline="${QUIZIJIE_BOOTSTRAP_EMPTY_BASELINE:-false}"
pull_images="${QUIZIJIE_PULL_IMAGES:-true}"
state_dir="${QUIZIJIE_RELEASE_STATE_DIR:-$root_dir/.release}"
compose=(docker compose -f compose.release.yaml)
if [[ -n "${QUIZIJIE_COMPOSE_OVERRIDE_FILE:-}" ]]; then
  if [[ ! -f "$QUIZIJIE_COMPOSE_OVERRIDE_FILE" ]]; then
    echo "Compose override does not exist: $QUIZIJIE_COMPOSE_OVERRIDE_FILE" >&2
    exit 1
  fi
  compose+=(-f "$QUIZIJIE_COMPOSE_OVERRIDE_FILE")
fi

if command -v node >/dev/null 2>&1; then
  node tools/check-deployment-env.js "$QUIZIJIE_API_ENV_FILE"
else
  docker run --rm \
    -v "$root_dir:/workspace:ro" \
    -v "$QUIZIJIE_API_ENV_FILE:/run/quzijie.env:ro" \
    -w /workspace \
    "${QUIZIJIE_PREFLIGHT_IMAGE:-node:24-alpine}" \
    node tools/check-deployment-env.js /run/quzijie.env
fi
mkdir -p "$state_dir"

if [[ "$pull_images" != "true" && "$pull_images" != "false" ]]; then
  echo "QUIZIJIE_PULL_IMAGES must equal true or false" >&2
  exit 1
fi

if [[ -f "$state_dir/current.env" ]]; then
  cp "$state_dir/current.env" "$state_dir/previous.env"
fi

if [[ "$pull_images" == "true" ]]; then
  "${compose[@]}" pull api migrate
fi
"${compose[@]}" --profile tools run --rm migrate

if [[ "$bootstrap_empty_baseline" != "true" && "$bootstrap_empty_baseline" != "false" ]]; then
  echo "QUIZIJIE_BOOTSTRAP_EMPTY_BASELINE must equal true or false" >&2
  exit 1
fi
if [[ "$bootstrap_empty_baseline" == "true" ]]; then
  "${compose[@]}" --profile tools run --rm \
    -e QUIZIJIE_ALLOW_EMPTY_BASELINE_IMPORT=IMPORT_EMPTY_BASELINE \
    migrate npm run db:bootstrap-baseline:compiled --workspace server
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
