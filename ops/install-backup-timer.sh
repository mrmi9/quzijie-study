#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_root="/opt/quzijie-study"

if [[ "$root_dir" != "$expected_root" ]]; then
  echo "Backup unit expects repository at $expected_root, got $root_dir" >&2
  exit 1
fi
if [[ ! -f "$root_dir/server/.env.production" ]]; then
  echo "Production environment file is missing" >&2
  exit 1
fi

sudo install -m 0644 "$root_dir/ops/systemd/quzijie-backup.service" /etc/systemd/system/quzijie-backup.service
sudo install -m 0644 "$root_dir/ops/systemd/quzijie-backup.timer" /etc/systemd/system/quzijie-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now quzijie-backup.timer
sudo systemctl start quzijie-backup.service
sudo systemctl is-active --quiet quzijie-backup.timer
sudo systemctl is-active --quiet quzijie-backup.service || [[ "$(sudo systemctl show -p Result --value quzijie-backup.service)" == "success" ]]
echo "Daily verified backup timer installed and initial backup passed."
