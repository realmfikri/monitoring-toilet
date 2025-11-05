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

### Deployment automation & secrets
- GitHub Actions handles dev (`deploy-dev.yml`) and production (`deploy-prod.yml`) rollouts.
- Configure dedicated environments in GitHub (`Settings` → `Environments`) with **separate** secrets for each stage:
  - Dev: `DEV_SSH_HOST`, `DEV_SSH_USER`, `DEV_SSH_KEY`, `DEV_PROJECT_PATH`, `DEV_HEALTHCHECK_URL`.
  - Prod: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `PROD_PROJECT_PATH`, `PROD_HEALTHCHECK_URL`.
- Store the SSH keys as PEM-formatted private keys. Use read-only deploy accounts on the VPS whenever possible.
- Keep environment-specific variables (database URLs, tokens, PM2 ecosystem configs) scoped to their respective environment to avoid accidental cross-stage leakage.

### Rollback procedures
If a deploy introduces regressions, revert to the previous healthy commit:

```bash
# Identify the previous commit from the CI summary or git log
ssh <dev-user>@<dev-host> 'cd /opt/toilet && git checkout <sha> && sudo systemctl restart toilet-api-dev && pm2 restart toilet-app-dev'

ssh <prod-user>@<prod-host> 'cd /opt/toilet && git checkout <sha> && sudo systemctl restart toilet-api && pm2 restart toilet-app'
```

- Use `git reflog` or the GitHub deployment summaries to pick the last known-good SHA.
- After rolling back, monitor `/healthz` and functional telemetry to confirm recovery.
- Remember to follow up with a forward-fix (new commit) so the main branch reflects the hotfix applied in production.

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

## Edge proxy (Nginx + Cloudflare)
### Deployment layout
- Config files live under `/etc/nginx/sites-enabled/toilet.conf`; see `infra/nginx/`
  for the authoritative template.
- Certbot materialises certificates inside `/etc/letsencrypt/live/` for
  `toilet-api.example.com` and `toilet-app.example.com` (wildcards also work).
- Cloudflare's Authenticated Origin Pull CA must be installed at
  `/etc/nginx/certs/cloudflare-origin-pull-ca.pem`. Without it, Cloudflare will
  refuse to connect when origin pulls are enforced.

### Service management
```bash
# Deploy or update the nginx.conf template
install -m 0644 /opt/toilet/infra/nginx/snippets/ssl-params.conf /etc/nginx/snippets/
cp /opt/toilet/infra/nginx/toilet.conf /etc/nginx/sites-enabled/toilet.conf
systemctl reload nginx

# Install the renewal helper (one-time)
install -m 0755 /opt/toilet/infra/nginx/renew-certificates.sh /usr/local/bin/renew-certificates.sh

# Enable the renewal timer
install -m 0644 /opt/toilet/infra/nginx/systemd/cert-renewal.service /etc/systemd/system/
install -m 0644 /opt/toilet/infra/nginx/systemd/cert-renewal.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cert-renewal.timer
```

### Certificate expiry alarms
- Primary signal: the twice-daily `cert-renewal.timer` writes to syslog with the
  `cert-renewal` tag. An absence alert should be configured in the logging
  backend if no success message appears for 48 hours.
- Secondary signal: schedule a Prometheus/Healthchecks probe that runs
  `certbot certificates --domain toilet-api.example.com` and `--domain
  toilet-app.example.com` daily. Trigger an alert when `Expiry Date` is < 21 days
  away.
- Manual verification:
  ```bash
  openssl s_client -connect toilet-api.example.com:443 -servername toilet-api.example.com </dev/null 2>/dev/null | openssl x509 -noout -dates
  ```

If renewals fail, inspect `/var/log/syslog` for the `cert-renewal` tag and rerun
`/usr/local/bin/renew-certificates.sh` with `CERTBOT_BIN=/snap/bin/certbot` when
using the snap-based installation.

### Cloudflare cache/WAF expectations
- API domains should always return `Cache-Control: no-store`. If a response is
  cached, purge it via the Cloudflare dashboard and verify Nginx still sets the
  header.
- The SPA shell may be temporarily cached by Cloudflare for inspection, but
  origin headers enforce `no-cache` in production and `no-store` for dev. Verify
  via `curl -I https://toilet-app.example.com`.
- Static assets (fingerprinted filenames) should include `Cache-Control: public,
  max-age=31536000, immutable`. If cache misses spike, confirm the
  `location` block in `toilet.conf` still matches the asset extensions.
