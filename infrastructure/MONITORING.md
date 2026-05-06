# JDLX Monitoring and Metrics Setup

## Monitoring Architecture

```text
Users -> NGINX -> Flask Backends
            |
            +--> nginx-exporter ----+
            |                       |
            +--> blackbox-exporter -+--> Prometheus --> Alertmanager
                                    |
cadvisor + node-exporter -----------+
                                    |
                                    +--> Grafana Dashboard (Admin Ops View)
```

## Metrics Collected

- API response time: `probe_duration_seconds` (blackbox probe through NGINX `/api/health`)
- Request counts: `nginx_http_requests_total` (nginx-prometheus-exporter)
- CPU usage: `container_cpu_usage_seconds_total` (cadvisor)
- Memory usage: `container_memory_working_set_bytes` (cadvisor)
- Server status: `probe_success`
- Error rate proxy: derived from health probe failures

## Alerts Configured

- `BackendDown` (server crash/unhealthy)
- `HighErrorRate` (health-check failure ratio high)
- `HighCPUUsage` (> 70%)
- `HighMemoryUsage` (> 80%)
- `HighResponseTime` (slow API response)

Alert rules file:
- `infrastructure/monitoring/prometheus/alerts.yml`

## Setup Instructions

1. Ensure frontend build exists:

```bash
cd frontend
npm run build
```

2. Start infrastructure + monitoring:

```bash
cd infrastructure
docker compose up -d --build
```

3. Open tools:

- App (through NGINX): `http://localhost`
- Prometheus: `http://localhost:9090`
- Alertmanager: `http://localhost:9093`
- Grafana: `http://localhost:3000`
  - Username: `admin`
  - Password: `admin123`

4. Dashboard:

- Grafana folder: `JDLX Monitoring`
- Dashboard: `JDLX Infrastructure Monitoring`

## Notes

- This extension is infra-only and does not change app logic or APIs.
- For production notifications, replace Alertmanager webhook receiver with Slack/Email/PagerDuty config.

