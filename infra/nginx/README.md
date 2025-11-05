# Nginx edge configuration

This directory provisions the Nginx reverse proxy that fronts the toilet
monitoring stack behind Cloudflare. It contains:

- `toilet.conf` – the main server block with HTTP→HTTPS redirects, backend proxy
  rules, and cache hints that mimic Cloudflare behaviour.
- `snippets/ssl-params.conf` – hardened TLS defaults that are included by every
  HTTPS virtual host.
- `systemd/` – automation units for certificate renewal.
- `renew-certificates.sh` – helper invoked by the systemd service.

## Domains and upstreams

The config expects the following domains:

| FQDN                        | Upstream                              | Notes |
|-----------------------------|---------------------------------------|-------|
| `toilet-api.example.com`    | `http://127.0.0.1:3000`               | Production Fastify backend |
| `toilet-api-dev.example.com`| `http://127.0.0.1:3300`               | Development backend sandbox |
| `toilet-app.example.com`    | `http://127.0.0.1:4173`               | Vite preview (serves built SPA) |
| `toilet-app-dev.example.com`| `http://127.0.0.1:5173`               | Vite dev server with live reload |

Update the `map` directives in `toilet.conf` if your deployment uses different
ports. Every virtual host includes an HTTP listener that permanently redirects
traffic to HTTPS.

## Cloudflare Authenticated Origin Pulls

Cloudflare should be configured to use Authenticated Origin Pulls with the
"Authenticated Origin Pulls" CA certificate. Mount the PEM file on the Nginx
host (for example via Ansible or Kubernetes secret) at
`/etc/nginx/certs/cloudflare-origin-pull-ca.pem`. The TLS server blocks already
reference this path with `ssl_client_certificate` and enforce verification via
`ssl_verify_client on`. If Cloudflare Authenticated Origin Pulls must be
temporarily disabled, comment out those directives and reload Nginx.

## Certificate management

Certificates are issued via Certbot using the DNS-01 challenge against
Cloudflare. The renewal workflow is:

1. Create `/etc/letsencrypt` using the standard Certbot layout and populate
   `/root/.secrets/certbot/cloudflare.ini` with an API token that has the
   `Zone.DNS` edit permission for the relevant zones.
2. Run Certbot interactively to obtain the wildcard certificates once, e.g.
   `certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini -d toilet-api.example.com -d toilet-app.example.com`.
3. Enable and start the `cert-renewal.timer` unit from `systemd/` so renewals are
   checked twice daily.
4. The `renew-certificates.sh` script reloads Nginx automatically whenever a
   certificate is renewed.

See the runbook for operational alarms around certificate expiry.

## Cache behaviour and Cloudflare parity

`toilet.conf` mirrors the cache and WAF policies that run in front of Cloudflare:

- API domains (`toilet-api*`) are treated as fully dynamic: responses are marked
  `Cache-Control: no-store`, and Nginx disables proxy caching entirely.
- The SPA shell (`/` on `toilet-app*`) returns `Cache-Control: no-cache` in
  production and `no-store` for dev. This allows Cloudflare to inspect requests
  while ensuring end users receive fresh HTML on refresh.
- Static assets (`/assets`, JS, CSS, images, fonts, etc.) are assigned
  `Cache-Control: public, max-age=31536000, immutable` in production. Dev traffic
  bypasses cache so changes are visible instantly.

These annotations keep the origin aligned with what the Cloudflare cache and WAF
expect, making it easier to reason about behaviour if either layer is bypassed.
