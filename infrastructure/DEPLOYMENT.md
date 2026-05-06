# JDLX Load Balancer Deployment

This setup adds horizontal backend scaling with NGINX reverse proxy and round-robin balancing.

## Architecture

Client -> NGINX (LB + Reverse Proxy) -> backend1/backend2/backend3 (Flask)

- NGINX config: `infrastructure/nginx/nginx.conf`
- Compose stack: `infrastructure/docker-compose.yml`
- Backend image: `infrastructure/docker/backend.Dockerfile`

## Prerequisites

1. Docker Desktop / Docker Engine + Docker Compose
2. Build frontend assets first so NGINX can serve them.

## Steps

1. Build frontend:

```bash
cd frontend
npm install
npm run build
```

2. Start load-balanced stack:

```bash
cd infrastructure
docker compose up -d --build
```

3. Validate:

```bash
docker compose ps
```

4. Access app:

- Frontend + API through NGINX: `http://localhost`
- Health endpoint (via proxy): `http://localhost/api/health`

## Notes

- NGINX uses round-robin across `backend1`, `backend2`, `backend3`.
- Failed upstreams are temporarily removed using passive checks (`max_fails` + `fail_timeout`) and upstream retry.
- SQLite is mounted as a shared file across backend instances for compatibility with current stack. For production-grade scaling, migrate to a network database (e.g. PostgreSQL).

