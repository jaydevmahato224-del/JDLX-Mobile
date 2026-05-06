# JDLX Auto-Scaling Infrastructure

This setup extends deployment architecture only (no API or app-logic change).

## System Architecture Diagram

```text
                    +---------------------+
                    |     End Users       |
                    +----------+----------+
                               |
                               v
                    +---------------------+
                    |  NGINX (jdlx-nginx) |
                    |  Reverse Proxy/LB   |
                    +----------+----------+
                               |
                               v
                 +-----------------------------+
                 | Service: jdlx-backend:5000 |
                 +------+------+---------------+
                        |      |      |
                        v      v      v
                   +--------+ +--------+ +--------+
                   | Pod #1 | | Pod #2 | | Pod #N |
                   | Flask  | | Flask  | | Flask  |
                   +--------+ +--------+ +--------+
                        ^           ^
                        |           |
              +---------+-----------+------------------+
              | HPA (CPU) + KEDA (RPS/Latency metrics)|
              +---------+-----------+------------------+
                        |
                        v
                 +---------------------+
                 | scaling logs script |
                 | scale_up/scale_down |
                 +---------------------+
```

## Auto-Scaling Configuration

- `Dockerfile`: containerized backend runtime
- `infrastructure/k8s/backend-deployment.yaml`: backend deployment + service
- `infrastructure/k8s/hpa.yaml`: CPU based autoscaling
  - scale up threshold: >70% CPU target utilization
  - scale down naturally when load drops
- `infrastructure/k8s/keda-scaledobject.yaml`: request-rate and response-time autoscaling (Prometheus)

## Deployment Scripts

- Deploy stack:

```bash
bash infrastructure/scripts/deploy-autoscaling.sh
```

- Watch and log scaling events:

```bash
bash infrastructure/scripts/watch_scaling_events.sh jdlx-backend default infrastructure/logs/autoscaling.log
```

## Notes

- NGINX auto-registers new backend instances through Kubernetes Service discovery.
- HPA requires Metrics Server in cluster.
- KEDA custom triggers require KEDA + Prometheus available in cluster.

