#!/usr/bin/env bash
# One-shot Shiprocket unblock retry:
#   1. Waits 30 min for the temporary security block to clear.
#   2. Tries login EXACTLY ONCE (no loops — repeated failures extend the block).
#   3. Only if login succeeds, runs the full live e2e dispatch test.
# Results are appended to /tmp/jdlx_sr_retry.log
set -u
LOG=/tmp/jdlx_sr_retry.log
BACKEND=/home/jaydev/Desktop/JDLX-Mobile/backend

echo "[$(date '+%Y-%m-%d %H:%M:%S')] waiting 30 min for Shiprocket block to clear..." > "$LOG"
sleep 1800
echo "[$(date '+%Y-%m-%d %H:%M:%S')] attempting ONE login..." >> "$LOG"

cd "$BACKEND"
python3 - <<'PY' >> "$LOG" 2>&1
import os
from dotenv import load_dotenv
load_dotenv('.env')
import shiprocket_client as sc
token = sc.get_token()
print('login success:', bool(token))
if token:
    print('SR_TOKEN_OK')
PY

if grep -q 'SR_TOKEN_OK' "$LOG"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] login OK — running full e2e dispatch test..." >> "$LOG"
    python3 "$BACKEND/scratch/test_live_shiprocket_dispatch.py" >> "$LOG" 2>&1
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] e2e test finished — see results above." >> "$LOG"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] still blocked — e2e NOT run (avoid more failed attempts). Wait longer and retry later." >> "$LOG"
fi
