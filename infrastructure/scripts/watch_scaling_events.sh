#!/usr/bin/env bash
set -euo pipefail

DEPLOYMENT="${1:-jdlx-backend}"
NAMESPACE="${2:-default}"
LOG_FILE="${3:-infrastructure/logs/autoscaling.log}"

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

echo "Watching scaling events for deployment=${DEPLOYMENT} namespace=${NAMESPACE}"

previous=""

while true; do
  current="$(kubectl -n "$NAMESPACE" get deployment "$DEPLOYMENT" -o jsonpath='{.status.replicas}' 2>/dev/null || echo 0)"
  current="${current:-0}"

  if [[ -z "$previous" ]]; then
    previous="$current"
  elif (( current > previous )); then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") scale_up from=${previous} to=${current}" | tee -a "$LOG_FILE"
    previous="$current"
  elif (( current < previous )); then
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") scale_down from=${previous} to=${current}" | tee -a "$LOG_FILE"
    previous="$current"
  fi

  sleep 10
done

