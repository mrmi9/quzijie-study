#!/usr/bin/env bash
set -euo pipefail

project_dir="${QUIZIJIE_PROJECT_DIR:-/opt/quzijie-study}"

if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  echo "Install nginx and certbot before bootstrapping ACME." >&2
  exit 1
fi

sudo install -d -m 0755 /var/www/certbot /etc/nginx/sites-available /etc/nginx/sites-enabled
sudo install -m 0644 "${project_dir}/ops/nginx/quzijie-acme-bootstrap.conf" /etc/nginx/sites-available/quzijie-acme-bootstrap.conf
sudo ln -sfn /etc/nginx/sites-available/quzijie-acme-bootstrap.conf /etc/nginx/sites-enabled/quzijie-acme-bootstrap.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "ACME HTTP-01 endpoint is ready on port 80."
