import subprocess
import os
import time

PROJECT_ROOT = "/home/jaydev/Desktop/JDLX-Mobile"

services = [
    {"cwd": "backend", "cmd": ["/home/jaydev/Desktop/JDLX-Mobile/backend/venv_linux/bin/python3", "app.py"]},
    {"cwd": "backend", "cmd": ["/home/jaydev/Desktop/JDLX-Mobile/backend/venv_linux/bin/python3", "system_bridge.py"]},
    {"cwd": "frontend-store", "cmd": ["/usr/local/bin/npm", "run", "dev", "--", "--host"]},
    {"cwd": "frontend-admin", "cmd": ["/usr/local/bin/npm", "run", "dev", "--", "--host"]},
    {"cwd": "frontend-warehouse", "cmd": ["/usr/local/bin/npm", "run", "dev", "--", "--host"]},
]

print("Launching all services with absolute paths...")
for s in services:
    try:
        log_file = os.path.join(PROJECT_ROOT, s["cwd"], f"detached_{s['cwd'].replace('/', '_')}.log")
        with open(log_file, "a") as f:
            subprocess.Popen(
                s["cmd"], 
                cwd=os.path.join(PROJECT_ROOT, s["cwd"]), 
                stdout=f,
                stderr=subprocess.STDOUT,
                start_new_session=True
            )
        print(f"Started {s['cmd']} in {s['cwd']}")
    except Exception as e:
        print(f"Failed to start {s['cmd']}: {e}")

time.sleep(2)
print("All services launched in background.")
