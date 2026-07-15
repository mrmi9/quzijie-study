#!/usr/bin/env bash
set -euo pipefail

project_dir="${QUIZIJIE_PROJECT_DIR:-/opt/quzijie-study}"
domain="api.qushuati.cloud"
certificate_dir="/etc/letsencrypt/live/${domain}"

if ! sudo test -f "${certificate_dir}/fullchain.pem" || ! sudo test -f "${certificate_dir}/privkey.pem"; then
  echo "Missing Let's Encrypt certificate for ${domain}; issue it before installing the final proxy." >&2
  exit 1
fi

sudo install -d -m 0755 /var/www/certbot /etc/nginx/conf.d /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/letsencrypt/renewal-hooks/deploy
sudo install -m 0644 "${project_dir}/ops/nginx/quzijie-rate-limit.conf" /etc/nginx/conf.d/quzijie-rate-limit.conf
sudo install -m 0644 "${project_dir}/ops/nginx/quzijie-api.conf" /etc/nginx/sites-available/quzijie-api.conf
sudo install -m 0755 "${project_dir}/ops/certbot/quzijie-nginx-reload.sh" /etc/letsencrypt/renewal-hooks/deploy/quzijie-nginx-reload.sh
sudo ln -sfn /etc/nginx/sites-available/quzijie-api.conf /etc/nginx/sites-enabled/quzijie-api.conf
sudo rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/quzijie-acme-bootstrap.conf
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx

echo "HTTPS proxy installed for https://${domain}:8443 -> http://127.0.0.1:3000"
