#!/usr/bin/env bash
set -euo pipefail

CERTBOT_BIN=${CERTBOT_BIN:-/usr/bin/certbot}
NGINX_CTL=${NGINX_CTL:-/usr/sbin/nginx}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-/bin/systemctl}
LOG_TAG="cert-renewal"

log() {
  logger -t "$LOG_TAG" "$1"
  printf '%s\n' "$1"
}

log "Starting certificate renewal run"

if ! command -v "$CERTBOT_BIN" >/dev/null 2>&1; then
  log "Certbot binary '$CERTBOT_BIN' not found"
  exit 1
fi

RENEW_OUTPUT=$($CERTBOT_BIN renew --quiet --deploy-hook "$SYSTEMCTL_BIN reload nginx" 2>&1) || {
  log "Certbot renew failed: $RENEW_OUTPUT"
  exit 1
}

if [ -n "$RENEW_OUTPUT" ]; then
  log "Certbot output: $RENEW_OUTPUT"
else
  log "Certbot completed with no changes"
fi

# Defensive reload in case deploy-hook missed it (e.g., non-zero exit).
$SYSTEMCTL_BIN reload nginx || {
  log "systemctl reload nginx failed, attempting direct nginx -s reload"
  $NGINX_CTL -s reload
}

log "Certificate renewal run complete"
