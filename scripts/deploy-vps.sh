#!/usr/bin/env bash
# Publica o app na VPS (container "brasa-app" em /opt/brasa-app): empacota, envia e reconstrói.
# Uso: bash scripts/deploy-vps.sh        (variáveis opcionais: DEPLOY_HOST, DEPLOY_KEY)
# O .env (DATABASE_URL, SESSION_SECRET, PLATFORM_KEY, WA_BOT_TOKEN...) fica só na VPS e nunca vai no pacote.
set -euo pipefail
HOST="${DEPLOY_HOST:-vitor@179.197.85.185}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/vps_upload_ed25519}"
cd "$(dirname "$0")/.."
PKG="$(mktemp -u /tmp/brasa-app.XXXXXX).tgz"
tar --exclude=node_modules --exclude=.git --exclude=data --exclude=uploads --exclude=sites --exclude=docs -czf "$PKG" .
scp -i "$KEY" -o BatchMode=yes "$PKG" "$HOST:/tmp/brasa-app.tgz"
rm -f "$PKG"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'set -e
  cd /opt/brasa-app && rm -rf src/* && tar -xzf /tmp/brasa-app.tgz -C src && rm -f /tmp/brasa-app.tgz
  sudo docker compose up -d --build 2>&1 | tail -3
  for i in $(seq 1 30); do [ "$(sudo docker inspect -f "{{.State.Health.Status}}" brasa-app)" = healthy ] && break; sleep 3; done
  echo "saúde: $(sudo docker inspect -f "{{.State.Health.Status}}" brasa-app)"'
curl -s -o /dev/null -w "site: HTTP %{http_code}\n" https://centraldoespeto.duckdns.org/api/config
