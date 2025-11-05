#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL environment variable must be set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET environment variable must be set (e.g. r2://bucket-name)}"
: "${BACKUP_RETENTION_DAYS:=30}"

TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
BACKUP_BASENAME="toilet-monitoring-${TIMESTAMP}.sql.gz"
BACKUP_TMP_DIR="${TMPDIR:-/tmp}/toilet-backups"
BACKUP_PATH="${BACKUP_TMP_DIR}/${BACKUP_BASENAME}"

mkdir -p "${BACKUP_TMP_DIR}"

PGPASSWORD="${DATABASE_PASSWORD:-}" pg_dump --dbname="${DATABASE_URL}" --format=plain --no-owner --no-privileges \
  | gzip > "${BACKUP_PATH}"

aws s3 cp "${BACKUP_PATH}" "${BACKUP_BUCKET}/${BACKUP_BASENAME}" --storage-class STANDARD_IA

rm -f "${BACKUP_PATH}"

aws s3 ls "${BACKUP_BUCKET}" | awk '{print $4}' \
  | grep '^toilet-monitoring-' \
  | while read -r object; do
      backup_date=$(echo "${object}" | sed -E 's/^toilet-monitoring-([0-9]{8})T([0-9]{6})Z.sql.gz$/\1T\2Z/')
      if [ -n "${backup_date}" ]; then
        backup_ts=$(date -u -d "${backup_date}" +%s)
        cutoff=$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%s)
        if [ "${backup_ts}" -lt "${cutoff}" ]; then
          aws s3 rm "${BACKUP_BUCKET}/${object}"
        fi
      fi
    done
