# Service Level Objectives

## Objective summary
| SLO | Target | Measurement window | SLI definition | Error budget |
| --- | --- | --- | --- | --- |
| API uptime | 99.9% | 30-day rolling | Minutes where `/healthz` returns HTTP 200 from primary regions ÷ total minutes | 43m 12s per month |
| API p95 latency | ≤ 450 ms | 30-day rolling | P95 of request duration for `/api/v1/*` measured at Cloudflare edge | 10% of requests may exceed target |
| Critical alert response | 95% within 10 minutes | Quarterly | Percentage of PagerDuty critical incidents acknowledged in ≤10 minutes | 5% of incidents may breach |

## Uptime SLO
- **SLI source**: Cloudflare health checks and Prometheus `up{service="toilet-api"}` series scraped every 30 seconds.
- **What counts as downtime**:
  - Any 5xx or timeout from `/healthz` for more than 2 consecutive minutes.
  - Maintenance windows must be announced 24h in advance and marked with the `planned_outage` label to exclude them.
- **Alerting**: Trigger a high-priority page when the 7-day burn rate exceeds 4× the 30-day error budget (Alertmanager multiwindow burn-rate alert).
- **Reporting**: Publish uptime percentage and downtime minutes in the monthly ops review. Include root cause summaries for any outage > 5 minutes.

## Latency SLO (p95 ≤ 450 ms)
- **SLI source**: Cloudflare Request Tracer logs aggregated in BigQuery table `cf_logs.toilet_requests`.
- **In-scope traffic**: Authenticated API routes `/api/v1/occupancy`, `/api/v1/alerts`, `/api/v1/devices` excluding `OPTIONS` preflight.
- **Computation**: Nightly Dataform job calculates rolling 30-day p50/p95/p99. Persist results to Looker dashboard `Toilet API Performance`.
- **Alerting**: Warn at 80% of latency budget via Slack (`#platform-alerts`), page at 100%. Include last deploy SHA and top endpoints in the alert payload.
- **Remediation guidance**: Investigate slow database queries (`pg_stat_statements`), origin saturation, or Cloudflare WAF mitigations adding delay.

## Critical alert response SLO
- **Scope**: PagerDuty incidents with severity `P1` or `P2` tied to the `toilet-monitoring` service.
- **Measurement**: Use PagerDuty Analytics export to calculate acknowledgement time. Automate weekly via `scripts/pagerduty_slo.py`.
- **Workflow expectations**:
  - Primary on-call acknowledges within 5 minutes; secondary must take over by 10 minutes if unacknowledged.
  - Incident commander posts an initial status update in `#incident-bridge` within 15 minutes and continues every 30 minutes until resolved.
- **Continuous improvement**: Review acknowledgement breaches during monthly retro and update runbook/alert routing.

## Capacity assumptions
- **Current load**: 200 monitored stalls, average 1 telemetry event every 30 seconds.
- **Expected growth**: 3× device count within 12 months; design for 600 concurrent stalls.
- **Backend headroom**: Target < 60% CPU and < 70% memory usage on the API nodes during peak hours.
- **Database**: Provision for 2,000 writes/minute and 500 reads/minute with 20 GB storage headroom. Enable auto-vacuum monitoring.
- **Cloudflare**: Plan for 1,500 requests/minute burst with caching absorbing 70% of SPA asset traffic.

## Tracking & reviews
- Dashboards: Prometheus + Grafana board `Toilet Monitoring - SLO` (uptime), Looker `Toilet API Performance` (latency), PagerDuty Analytics `On-call health` (response).
- Error budget policy: Freeze feature launches if any SLO consumes > 50% of its monthly budget; focus solely on reliability improvements until back under threshold.
- Review cadence: Present SLO status in the monthly ops review and publish a quarterly deep-dive summarising trends, breaches, and corrective actions.
