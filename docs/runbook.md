# Toilet Monitoring Backend Runbook

## Environment Variables
The following variables are required for a healthy deployment. Defaults come from `env.example`; override them per environment using GitHub Action secrets or `/etc/toilet-monitoring/.env` on the servers.

| Variable | Scope | Description | Default | Owner |
| --- | --- | --- | --- | --- |
| `NODE_ENV` | Backend | Enables production optimisations. | `development` | Platform Engineering |
| `PORT` / `HOST` | Backend | Bind address for the API process. | `3000` / `0.0.0.0` | Platform Engineering |
| `CORS_ALLOWED_ORIGINS*` | Backend | Whitelist for SPA origins. | `http://localhost:5173` | Backend Services |
| `API_KEYS_*` | Backend | Comma-separated ingestion keys per environment. | `local-dev-key` | Backend Services |
| `RATE_LIMIT_*` | Backend | Optional overrides for rate-limiter window/max. | `60000` / env specific | Backend Services |
| `REQUIRE_CLOUDFLARE_AUTH` | Backend | Enforce Cloudflare signed requests. | `true` | Platform Engineering |
| `TELEGRAM_POLLING` | Backend | Switches webhook vs polling. | `true` | Facilities Ops |
| `TELEGRAM_BOT_TOKEN` | Backend | Bot credential for alerting. | _unset_ | Facilities Ops |
| `DATABASE_URL` | Backend | Connection string for PostgreSQL. | Local dev DSN | Platform Engineering |
| `DATABASE_PASSWORD` | Backend | Optional when password omitted in URL. | _unset_ | Platform Engineering |
| `BACKUP_BUCKET` | Scripts | S3/R2 bucket for dumps. | `s3://toilet-monitoring-backups` | Platform Engineering |
| `BACKUP_RETENTION_DAYS` | Scripts | Controls retention window. | `30` | Platform Engineering |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` | Scripts | Credentials for backup transport. | _unset_ | Platform Engineering |
| `VITE_API_BASE_URL` | Frontend | Points SPA to API origin. | `http://localhost:3000` | Frontend Experience |

Document any additional overrides (feature flags, experiment toggles) in this table during change reviews.

## Service Ports & Endpoints
| Component | Port | Exposure | Notes |
| --- | --- | --- | --- |
| Backend API (`backend/`) | 3000 (HTTP) | Internal (behind Nginx) | Health endpoint `/healthz`; telemetry `/metrics` via auth. |
| Frontend SPA (`frontend/`) | 4173 (preview) / 5173 (dev) | Internal during build | Served via Nginx on 443 in production. |
| Nginx | 80 / 443 | Public | Terminates TLS; proxies to API and SPA upstreams. |
| PostgreSQL | 5432 | Private VLAN | Managed by platform DB host. |
| PM2 control socket | Local | Private | Keep bound to localhost; used by deploy scripts. |

Always confirm ports with `ss -tulpn` when diagnosing bind errors.

## Certificates & Secrets
- **ACME/Let's Encrypt** assets live under `/etc/letsencrypt/live/`.
- Cloudflare Origin Pull CA is installed at `/etc/nginx/certs/cloudflare-origin-pull-ca.pem`.
- GitHub Actions secrets store SSH keys (`*_SSH_KEY`) and per-environment deploy metadata. Keep keys PEM-formatted and rotate annually.
- Export Telegram bot secrets and database credentials via Ansible vault or GitHub environment secrets; never commit plaintext tokens.

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

### Manual deployment commands
Use when automation is unavailable or for hotfixes. Replace placeholders with environment-specific values.

```bash
ssh <deploy-user>@<target-host> <<'EOF'
set -euo pipefail
cd /opt/toilet
git fetch origin
git checkout <branch-or-sha>
npm --prefix backend ci
npm --prefix backend run build
pm2 reload toilet-api --update-env
pm2 reload toilet-app --update-env
EOF
```

- Run `npx prisma migrate deploy` before `pm2 reload` if schema changes landed.
- Confirm health by curling `https://toilet-api.example.com/healthz` and loading the SPA root.

### Deployment automation & secrets
- GitHub Actions handles dev (`deploy-dev.yml`) and production (`deploy-prod.yml`) rollouts.
- Configure dedicated environments in GitHub (`Settings` → `Environments`) with **separate** secrets for each stage:
  - Dev: `DEV_SSH_HOST`, `DEV_SSH_USER`, `DEV_SSH_KEY`, `DEV_PROJECT_PATH`, `DEV_HEALTHCHECK_URL`.
  - Prod: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `PROD_PROJECT_PATH`, `PROD_HEALTHCHECK_URL`.
- Store the SSH keys as PEM-formatted private keys. Use read-only deploy accounts on the VPS whenever possible.
- Keep environment-specific variables (database URLs, tokens, PM2 ecosystem configs) scoped to their respective environment to avoid accidental cross-stage leakage.
- CI verifies deployments by curling the configured healthcheck URL and tailing PM2 logs for 60 seconds. If automation fails, fall back to the manual commands above and open an incident report.

### Device provisioning & API key rotation
Field hardware stores its Wi-Fi credentials, device identifier, and API access parameters in SPIFFS at `/config.json`. Devices boot with a default ingestion target of `https://toilet-api-dev.example.com/data` and validate TLS using the bundled Let's Encrypt ISRG Root X1 certificate. Updates arrive via the WiFiManager captive portal:

1. Hold the physical `GPIO0` button for ≥3 seconds until the device announces `START AP` on the OLED.
2. Connect to the ad-hoc network `ToiletSetup` (password `monitor123`) and browse to `http://192.168.4.1/`.
3. Provide Wi-Fi credentials plus the latest values for **Device ID**, **API Base URL**, and **API Key**. The firmware automatically persists these fields to `/config.json` and reuses them after reboot.
4. Confirm the LED stops blinking and the status screen shows the updated Device ID and IP address.

When rotating backend secrets, operations only need to repeat steps 1–3 with the fresh API key (or host) and the device will immediately start sending HTTPS requests with the correct `X-API-Key` header.

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

### Cloudflare configuration
#### DNS records
- `api.toilet.example.com` → proxied A record to origin IP (orange-cloud enabled).
- `app.toilet.example.com` → proxied CNAME to the same host or Pages entry.
- `origin.toilet.example.com` → **unproxied** A record reserved for diagnostics.
- Keep TTL at `auto` so failovers propagate quickly.

#### SSL/TLS mode
- Set zone SSL mode to **Full (strict)**.
- Upload the Origin Pull certificate (`cloudflare-origin-pull-ca.pem`) and enable Authenticated Origin Pulls per hostname.
- Enforce minimum TLS 1.2 and modern cipher suites in the Cloudflare dashboard.

#### Web Application Firewall & caching
- Enable the “API Shield” managed ruleset and OWASP Core Ruleset in `simulate` for staging and `block` in production.
- Allowlist the device IP range via a custom firewall rule tagged `device-ingest`.
- Cache rules:
  - Bypass cache for `api.toilet.example.com/*`.
  - Cache `app.toilet.example.com` HTML for 5 minutes (for inspection) while respecting origin `Cache-Control`.
  - Cache static assets (`*.js`, `*.css`, `*.png`, etc.) with `Cache Everything` and Edge TTL 1 year.

#### Zero Trust access
- Create an Access application for `/admin/*` paths requiring Okta group `toilet-operators`.
- Generate a service token pair for CI health checks and store values as `CFZT_CLIENT_ID` / `CFZT_CLIENT_SECRET` in GitHub secrets.
- Log Access events to Cloudflare Logpush → R2 bucket `cf-zero-trust-logs` for auditing.

#### Acceptance checks
Run these after any infrastructure change to guarantee reproducibility:
- `dig +short api.toilet.example.com` returns a Cloudflare Anycast IP, while `dig +short origin.toilet.example.com` resolves to the raw origin.
- `curl -sSI https://api.toilet.example.com/healthz` shows `HTTP/2 200`, `cf-cache-status: DYNAMIC`, and `cache-control: no-store`.
- `curl -sSI https://app.toilet.example.com` includes `cache-control: no-cache` and a recent `cf-ray` header.
- From an unauthorised network, hitting `https://app.toilet.example.com/admin/` prompts for Zero Trust authentication.
- Verify WAF analytics report traffic tagged with `device-ingest` as allowed and other malicious traffic blocked.

## Escalation & Contacts
| Role | Contact | Escalation notes |
| --- | --- | --- |
| Primary on-call (24/7) | PagerDuty schedule `toilet-monitoring` | Acknowledge pages within 5 minutes; escalate to secondary after 10 minutes without response. |
| Secondary on-call | `@platform-eng` Slack channel | Join bridges, coordinate rollback, and notify stakeholders. |
| Database administrator | db-oncall@toilet.example.com | Required for backup/restore failures or data corruption. |
| Facilities operations lead | facilities@toilet.example.com | Coordinate hardware access, restroom closures, and customer updates. |
| Cloudflare support | Support ticket via Enterprise portal | Reference account `ACME-Toilet` and attach recent `cf-ray` headers. |

Record all incidents in the shared postmortem document within 48 hours of resolution.
