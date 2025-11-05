# Toilet Monitoring Backend Runbook

## Storage Overview
- **Database**: PostgreSQL (managed via Prisma) stores all device snapshots, history logs, Telegram subscriptions, and configuration overrides.
- **Connection string**: Configure via `DATABASE_URL` (see `env.example`). The production database currently runs on the shared VPS (`103.126.116.102`).
- **Latest readings**: `DeviceLatestSnapshot` table keeps the most recent payload per device.
- **History retention**: `DeviceHistory` table automatically prunes entries older than 30 days or beyond the latest 1,000 rows per device using the `device_history_retention` trigger.

## Operational Tasks
### Apply database migrations
```bash
cd backend
npm install
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma migrate deploy
PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 npx prisma generate
```
> The checksum flag is only required in restricted environments where Prisma engine downloads are blocked.

### Service startup
1. Ensure `DATABASE_URL`, `API_KEYS_*`, and Telegram credentials are populated.
2. Start the API service:
   ```bash
   cd backend
   npm run build
   npm run start
   ```

## Backups
### Nightly backup job
- Script: `scripts/backup.sh`
- Requirements:
  - `DATABASE_URL` (and optionally `DATABASE_PASSWORD` if the URL omits the password).
  - AWS-compatible credentials for Cloudflare R2/S3 exported as standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_DEFAULT_REGION`.
  - `BACKUP_BUCKET` pointing at the desired R2/S3 bucket (e.g. `s3://toilet-monitoring-backups`).
  - Optional `BACKUP_RETENTION_DAYS` (defaults to 30).
- Example cron entry (run at 02:30 UTC daily):
  ```cron
  30 2 * * * /opt/toilet/scripts/backup.sh >> /var/log/toilet-backup.log 2>&1
  ```
- The script performs:
  1. `pg_dump` of the configured database.
  2. Upload of the compressed dump to Cloudflare R2/S3 with IA storage class.
  3. Retention enforcement by deleting objects older than the configured window.

### Restore drills
Perform at least once per quarter:
1. Download the desired backup:
   ```bash
   aws s3 cp s3://toilet-monitoring-backups/toilet-monitoring-<timestamp>.sql.gz /tmp/restore.sql.gz
   gunzip /tmp/restore.sql.gz
   ```
2. Restore into a staging database:
   ```bash
   createdb toilet_monitoring_restore
   psql postgresql://<user>:<password>@localhost/toilet_monitoring_restore -f /tmp/restore.sql
   ```
3. Point the staging API to the restored database (`DATABASE_URL=postgresql://.../toilet_monitoring_restore`) and run smoke tests:
   ```bash
   npm run build && npm run start
   ```
4. Document results (success/failure, time taken) in the operations log.

## Troubleshooting
- **API fails to start**: Verify database connectivity (`psql $DATABASE_URL -c 'select 1'`).
- **Missing data in dashboard**: Check `DeviceHistory` retention triggers and ensure cron backup/cleanup jobs ran successfully.
- **Telegram alerts missing**: Confirm subscribers exist in `TelegramSubscriber` table and the bot token is valid.
