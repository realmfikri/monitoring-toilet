## Toilet Monitoring Deployment Notes

### Environment Preparation
- Installed backend and frontend dependencies (`npm ci` / `npm install`) as the `deploy` user.
- Created environment configuration files:
  - `backend/.env.production`, `backend/.env.development`
  - `frontend/.env.production`, `frontend/.env.development`
- Provisioned PostgreSQL role `toilet_app`, granted it ownership of `toilet_monitoring`, and executed Prisma migrations and client generation.

### Application Build & Runtime
- Patched Prisma repositories to satisfy TypeScript build checks and ran `npm run build` in the backend.
- Built the frontend SPA (`frontend/dist`) via `npm run build` and installed the global `serve` CLI.
- Authored `ecosystem.config.cjs` defining four PM2 apps:
  - `toilet-api` (prod API) on port 3000.
  - `toilet-api-dev` (dev API) on port 3300.
  - `toilet-app` serving the built dashboard on port 4173.
  - `toilet-app-dev` running `vite --host --port 5173`.
- Started the processes with PM2, enabled systemd startup, and saved the ecosystem.

### Nginx & TLS
- Customized `infra/nginx/toilet.conf` for the `*.muhamadfikri.com` hostnames and deployed it to `/etc/nginx/sites-available/toilet.conf`.
- Copied the hardened TLS snippet to `/etc/nginx/snippets/ssl-params.conf` and removed the default site.
- Stored the Cloudflare DNS token at `/root/.secrets/certbot/cloudflare.ini` (600 permissions).
- Issued Let’s Encrypt certificates (DNS-01 via Cloudflare) for:
  - `toilet-api.muhamadfikri.com`, `toilet-api-dev.muhamadfikri.com`.
  - `toilet-app.muhamadfikri.com`, `toilet-app-dev.muhamadfikri.com`.
- Reloaded Nginx after validation; HTTPS now serves the API and SPA.

### Firewall & Verification
- Enabled ufw profile `Nginx Full` to allow inbound ports 80/443.
- Set `REQUIRE_CLOUDFLARE_AUTH=true` in `backend/.env.production` and restarted the PM2 service with `--update-env`.
- Verified origin responses locally with `curl --resolve ... https://toilet-*.muhamadfikri.com`, ensuring Cloudflare can now connect.

### Follow-up
- Certbot renewals rely on the Cloudflare token; rotate it by updating the credentials file and re-running `certbot renew --dry-run`.
- PM2 logs live under `/home/deploy/.pm2/logs/`; use `pm2 logs <name>` for troubleshooting.

### 2025-11-20 Release & Hotfix (DeviceSettings + UI rebuild)
- Issue: backend crashed on start with `PrismaClientKnownRequestError P2021` because the new `DeviceSettings` table was not migrated; frontend build missed `VITE_API_BASE_URL`, so `/api/login` failed with “Tidak dapat terhubung ke server.”
- Fix steps:
  - Add the missing migration `backend/prisma/migrations/0005_add_device_settings` and run `cd backend && set -a && source .env.production && set +a && npx prisma migrate deploy` as the `deploy` user.
  - Verify `.env.production` still sets `AUTH_SECRET`, `DATABASE_URL`, `API_KEYS_*`, `CORS_ALLOWED_ORIGINS`, and `REQUIRE_CLOUDFLARE_AUTH`.
  - Rebuild backend `cd backend && npm run build`.
  - Rebuild frontend `cd frontend && npm run build` (uses `.env.production` for API base URL).
  - Restart PM2 apps under deploy: `PM2_HOME=/home/deploy/.pm2 pm2 restart toilet-api --update-env` and `pm2 restart toilet-app`.
- Post-checks:
  - `tail -f /home/deploy/.pm2/logs/toilet-api-out-0.log` to see `/data` posts and `Server is running`.
  - UI login works at `https://toilet-app.muhamadfikri.com` using the supervisor account after the rebuild.
