#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-${UPTIME_BASE_URL:-"http://127.0.0.1:3000"}}
HEALTH_ENDPOINT="${BASE_URL%/}/healthz"
TIMEOUT=${UPTIME_TIMEOUT_SECONDS:-10}
EXPECTED_STATUS=${UPTIME_EXPECTED_STATUS:-200}

TMP_STATUS=$(mktemp)
TMP_ERROR=$(mktemp)
trap 'rm -f "$TMP_STATUS" "$TMP_ERROR"' EXIT

status_line=$(curl --silent --show-error --fail-with-body \
  --max-time "$TIMEOUT" \
  --output /dev/null \
  --write-out '%{http_code} %{time_total}' \
  "$HEALTH_ENDPOINT" 2>"$TMP_ERROR" || true)

read -r status latency <<<"${status_line:-}" || true
status=${status:-000}
latency=${latency:-0}

if [[ "$status" != "$EXPECTED_STATUS" ]]; then
  failure_reason=$(<"$TMP_ERROR")
  message="[monitoring-toilet] Uptime probe failed: status=$status expected=$EXPECTED_STATUS latency=${latency}s url=$HEALTH_ENDPOINT"
  if [[ -n "$failure_reason" ]]; then
    message+=$'\nError: '
    message+="$failure_reason"
  fi

  if [[ -n "${UPTIME_TELEGRAM_BOT_TOKEN:-}" && -n "${UPTIME_TELEGRAM_CHAT_ID:-}" ]]; then
    curl --silent --show-error --request POST \
      "https://api.telegram.org/bot${UPTIME_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${UPTIME_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${message}" \
      --data-urlencode "disable_notification=${UPTIME_TELEGRAM_SILENT:-false}" >/dev/null || true
  fi

  if command -v logger >/dev/null 2>&1; then
    logger -t monitoring-toilet-uptime -- "$message"
  else
    printf '%s\n' "$message" >&2
  fi

  exit 1
fi

if [[ "${UPTIME_PROBE_LOG_SUCCESS:-false}" == "true" ]]; then
  printf '[monitoring-toilet] Uptime probe succeeded: status=%s latency=%ss url=%s\n' "$status" "$latency" "$HEALTH_ENDPOINT"
fi
