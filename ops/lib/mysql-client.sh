#!/usr/bin/env bash

mysql_option_quote() {
  local value="$1"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "MySQL credentials must not contain newlines" >&2
    return 1
  fi
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

create_mysql_client_defaults() {
  local defaults_file="$1"
  local database_override="${2:-}"
  local database_url="${DATABASE_ADMIN_URL:-${DATABASE_URL:-}}"

  umask 077
  if [[ -n "$database_url" ]]; then
    command -v node >/dev/null 2>&1 || {
      echo "Node.js is required to parse DATABASE_URL safely" >&2
      return 1
    }
    QUIZIJIE_MYSQL_DATABASE="$(
      QUIZIJIE_MYSQL_URL="$database_url" \
      QUIZIJIE_MYSQL_DEFAULTS_FILE="$defaults_file" \
      QUIZIJIE_MYSQL_DATABASE_OVERRIDE="$database_override" \
      node <<'NODE'
const fs = require("node:fs");
const url = new URL(process.env.QUIZIJIE_MYSQL_URL || "");
if (url.protocol !== "mysql:") throw new Error("DATABASE_URL/DATABASE_ADMIN_URL must use mysql://");
const decode = (value) => decodeURIComponent(value || "");
const database = process.env.QUIZIJIE_MYSQL_DATABASE_OVERRIDE || decode(url.pathname.replace(/^\//, ""));
const values = {
  host: url.hostname,
  port: url.port || "3306",
  user: decode(url.username),
  password: decode(url.password)
};
if (!values.host || !values.user || !values.password || !database) {
  throw new Error("MySQL URL must include host, username, password and database");
}
const quote = (value) => {
  if (/\r|\n/.test(value)) throw new Error("MySQL credentials must not contain newlines");
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};
const content = [
  "[client]",
  `host=${quote(values.host)}`,
  `port=${values.port}`,
  `user=${quote(values.user)}`,
  `password=${quote(values.password)}`,
  "protocol=TCP",
  ""
].join("\n");
fs.writeFileSync(process.env.QUIZIJIE_MYSQL_DEFAULTS_FILE, content, { encoding: "utf8", mode: 0o600 });
fs.chmodSync(process.env.QUIZIJIE_MYSQL_DEFAULTS_FILE, 0o600);
process.stdout.write(database);
NODE
    )"
  else
    : "${MYSQL_ADDRESS:?environment file is missing MYSQL_ADDRESS}"
    : "${MYSQL_USERNAME:?environment file is missing MYSQL_USERNAME}"
    : "${MYSQL_PASSWORD:?environment file is missing MYSQL_PASSWORD}"
    : "${MYSQL_DATABASE:?environment file is missing MYSQL_DATABASE}"
    local host port
    if [[ "$MYSQL_ADDRESS" =~ ^\[([^]]+)\]:([0-9]+)$ ]]; then
      host="${BASH_REMATCH[1]}"
      port="${BASH_REMATCH[2]}"
    elif [[ "$MYSQL_ADDRESS" =~ ^([^:]+):([0-9]+)$ ]]; then
      host="${BASH_REMATCH[1]}"
      port="${BASH_REMATCH[2]}"
    else
      echo "MYSQL_ADDRESS must use host:port or [IPv6]:port" >&2
      return 1
    fi
    QUIZIJIE_MYSQL_DATABASE="${database_override:-$MYSQL_DATABASE}"
    {
      printf '[client]\n'
      printf 'host=%s\n' "$(mysql_option_quote "$host")"
      printf 'port=%s\n' "$port"
      printf 'user=%s\n' "$(mysql_option_quote "$MYSQL_USERNAME")"
      printf 'password=%s\n' "$(mysql_option_quote "$MYSQL_PASSWORD")"
      printf 'protocol=TCP\n'
    } > "$defaults_file"
    chmod 600 "$defaults_file"
  fi

  if [[ ! "$QUIZIJIE_MYSQL_DATABASE" =~ ^[A-Za-z0-9_]+$ ]]; then
    echo "MySQL database name may contain only letters, digits and underscores" >&2
    return 1
  fi
  export QUIZIJIE_MYSQL_DATABASE
}
