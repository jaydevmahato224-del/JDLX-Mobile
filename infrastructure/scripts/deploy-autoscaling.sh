#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "[1/4] Building backend image..."
docker build -f "${ROOT_DIR}/Dockerfile" -t jdlx/backend:latest "${ROOT_DIR}"

echo "[2/4] Applying backend deployment + service..."
kubectl apply -f "${ROOT_DIR}/infrastructure/k8s/backend-deployment.yaml"

echo "[3/4] Applying NGINX reverse proxy..."
kubectl apply -f "${ROOT_DIR}/infrastructure/k8s/nginx.yaml"

echo "[4/4] Applying auto-scaling policies (HPA + optional KEDA)..."
kubectl apply -f "${ROOT_DIR}/infrastructure/k8s/hpa.yaml"
kubectl apply -f "${ROOT_DIR}/infrastructure/k8s/keda-scaledobject.yaml" || true

echo "Deployment completed."
echo "Check status:"
echo "  kubectl get deploy,svc,hpa"

