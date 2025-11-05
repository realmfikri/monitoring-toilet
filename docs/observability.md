# Observability Guide

This document describes how to operate the backend with production-grade logging and uptime probing.

## Structured logging

The backend now uses [`pino`](https://github.com/pinojs/pino) with [`pino-http`](https://github.com/pinojs/pino-http) to emit JSON logs. Two log streams are produced:

| Stream | Default file | Contents |
| --- | --- | --- |
| Access | `logs/access.log` | One entry per HTTP request with `timestamp`, `requestId`, `clientIp`, `deviceId`, `latencyMs`, and `outcome` (`success`, `rejected`, or `error`). |
| Application/Error | `logs/app.log` + `logs/error.log` | Background tasks, database operations, and structured errors. Critical logs (`error`+) are copied to `error.log`. |

Environment variables:

- `LOG_DIR` – root directory for log files (default: `<repo>/logs`).
- `ACCESS_LOG_PATH`, `APP_LOG_PATH`, `ERROR_LOG_PATH` – override individual file locations.
- `LOG_LEVEL`, `ACCESS_LOG_LEVEL` – control verbosity.
- `LOG_TO_STDOUT=false` – disable console mirroring (useful for systemd units that journal logs).

Every incoming request receives a `requestId`. If Cloudflare forwards a `CF-Ray` header the ID is reused, otherwise a UUID is generated. The ID is attached to:

- Access log entries through `pino-http`.
- All request-scoped application logs (use `req.log` instead of `console.log`).
- Telegram notifications triggered by the request (the message includes `Request ID: <id>`), enabling responders to cross-reference alerts with logs quickly.

## Log rotation

The repository ships a sample [`logrotate`](https://linux.die.net/man/8/logrotate) policy at `scripts/logrotate/monitoring-toilet`. Copy it into `/etc/logrotate.d/` and customise ownership if the service runs under a non-root user:

```bash
sudo install -m 0644 scripts/logrotate/monitoring-toilet /etc/logrotate.d/monitoring-toilet
sudo mkdir -p /var/log/monitoring-toilet
sudo chown <service-user>:<service-group> /var/log/monitoring-toilet
```

The policy rotates daily, keeps 14 compressed archives, and asks `systemctl` to signal the service (`USR1`) so file descriptors are reopened if necessary. If you run the app outside systemd, replace the `postrotate` block with the appropriate command (e.g., `pm2 reload <name>`).

### Shipping logs to a central sink

Because all logs are JSON, any modern log forwarder can ship them with minimal parsing. Examples:

- **Fluent Bit**

  ```ini
  [INPUT]
      Name              tail
      Path              /var/log/monitoring-toilet/*.log
      Parser            json
      Tag               monitoring-toilet
      Refresh_Interval  5

  [OUTPUT]
      Name              http
      Match             monitoring-toilet
      Host              logs.example.com
      URI               /ingest
      Format            json_stream
  ```

- **Vector**

  ```toml
  [sources.monitoring_toilet]
  type = "file"
  include = ["/var/log/monitoring-toilet/*.log"]
  decoding.codec = "json"

  [transforms.add_metadata]
  type = "remap"
  inputs = ["monitoring_toilet"]
  source = " .service = \"monitoring-toilet-backend\" "

  [sinks.loki]
  type = "loki"
  inputs = ["add_metadata"]
  endpoint = "https://loki.example.com"
  encoding.codec = "json"
  ```

Adjust endpoints/credentials to match your logging backend (Loki, Elasticsearch, Cloud Logging, etc.).

## Uptime probing

Use `scripts/uptime-probe.sh` to check `/healthz` on a schedule. It exits non-zero and sends a Telegram alert whenever the status differs from the expected code (default `200`). Configuration via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `UPTIME_BASE_URL` | `http://127.0.0.1:3000` | Base URL for the backend. |
| `UPTIME_TIMEOUT_SECONDS` | `10` | Curl timeout. |
| `UPTIME_EXPECTED_STATUS` | `200` | HTTP status that counts as healthy. |
| `UPTIME_TELEGRAM_BOT_TOKEN` | _unset_ | Optional Telegram bot token for paging. |
| `UPTIME_TELEGRAM_CHAT_ID` | _unset_ | Chat/group ID that should receive alerts. |
| `UPTIME_TELEGRAM_SILENT` | `false` | Send silent Telegram alerts when `true`. |
| `UPTIME_PROBE_LOG_SUCCESS` | `false` | Emit success logs when set to `true`. |

Example cronjob (runs every minute):

```cron
* * * * * BASE_URL=https://monitoring.example.com UPTIME_TELEGRAM_BOT_TOKEN=xxxx \
    UPTIME_TELEGRAM_CHAT_ID=123456 ./scripts/uptime-probe.sh
```

The script also logs failures via the system `logger` command when available so you can hook into syslog-based alerting stacks.
