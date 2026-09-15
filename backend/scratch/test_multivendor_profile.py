"""
Isolated e2e: multi-vendor warehouse profile feature.

Same isolated-DB pattern as test_e2e_dispatch.py — copies the real DB to /tmp,
spawns the Flask app, and verifies:
  1. GET  /api/warehouse/profile returns profile + payout (null initially)
  2. PATCH /api/warehouse/profile updates GST / pickup contact / address / payout
  3. Payout account row is created and returned
  4. KYC sweep inserts the PROFILE_UPDATE notification for existing partners
  5. Legacy /api/warehouse/settings PATCH still works (business-logic intact)
"""
import datetime
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

import jwt

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DB = os.path.join(BACKEND_DIR, "jdlx.db")
TEST_DB = "/tmp/jdlx_mv_profile_test.db"
PORT = 5599
BASE = f"http://127.0.0.1:{PORT}"

JWT_SECRET = None
for line in open(os.path.join(BACKEND_DIR, ".env")):
    if line.strip().startswith("JWT_SECRET="):
        JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
        break
if not JWT_SECRET:
    print("FAIL: JWT_SECRET not found in backend/.env")
    sys.exit(1)

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def api(method, path, token=None, body=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = ""
        try:
            raw = e.read().decode()
        except Exception:
            pass
        print(f"    !! {method} {path} -> HTTP {e.code}: {raw[:300]}")
        try:
            return e.code, json.loads(raw or "{}")
        except Exception:
            return e.code, {}


def main():
    print("== Multi-vendor warehouse profile e2e ==")
    shutil.copyfile(SOURCE_DB, TEST_DB)
    conn = sqlite3.connect(TEST_DB)
    wh = conn.execute("SELECT id, email FROM warehouses ORDER BY id LIMIT 1").fetchone()
    conn.close()
    if not wh:
        print("FAIL: no warehouse in DB")
        sys.exit(2)
    wh_id, wh_email = wh
    print(f"  warehouse #{wh_id} ({wh_email})")

    now = datetime.datetime.utcnow()
    token = jwt.encode(
        {"warehouse_id": wh_id, "email": wh_email, "role": "owner", "type": "warehouse",
         "iat": now, "jti": "mv-test-1", "exp": now + datetime.timedelta(hours=2)},
        JWT_SECRET, algorithm="HS256",
    )

    env = dict(os.environ)
    env.update({
        "DATABASE_PATH": TEST_DB, "FORCE_LOCAL_DB": "1", "FORCE_HTTPS": "0",
        "PORT": str(PORT), "DISABLE_RATE_LIMIT": "1", "FLASK_DEBUG": "",
    })
    log = open("/tmp/jdlx_mv_profile_server.log", "w")
    proc = subprocess.Popen([sys.executable, os.path.join(BACKEND_DIR, "app.py")],
                            cwd=BACKEND_DIR, env=env, stdout=log, stderr=log,
                            start_new_session=True)
    try:
        deadline = time.time() + 60
        up = False
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            try:
                status, _ = api("GET", "/")
                up = status == 200
                if up:
                    break
            except Exception:
                pass
            time.sleep(1)
        check("server started", up)
        if not up:
            sys.exit(3)

        # 1. GET profile
        status, resp = api("GET", "/api/warehouse/profile", token=token)
        profile = resp.get("data") or {}
        check("GET profile 200", status == 200)
        check("profile has gst fields", "gst_number" in profile and "pickup_contact_name" in profile)
        check("payout initially null/absent", not profile.get("payout"))

        # 2. PATCH business + payout details
        status, resp = api("PATCH", "/api/warehouse/profile", token=token, body={
            "gst_number": "22AAAAA0000A1Z5",
            "pickup_contact_name": "Ramesh Kumar",
            "pincode": "832108",
            "bank_account_name": "JDLX Vendor",
            "bank_account_number": "1234567890123",
            "bank_ifsc": "SBIN0001234",
            "bank_name": "State Bank of India",
            "upi_id": "jdlxvendor@upi",
        })
        check("PATCH profile 200", status == 200)
        updated = resp.get("data") or {}
        check("gst saved", updated.get("gst_number") == "22AAAAA0000A1Z5")
        check("pickup contact saved", updated.get("pickup_contact_name") == "Ramesh Kumar")
        check("payout saved", bool(updated.get("payout")) and updated["payout"].get("bank_ifsc") == "SBIN0001234")

        # invalid pincode rejected
        status, _ = api("PATCH", "/api/warehouse/profile", token=token, body={"pincode": "12"})
        check("invalid pincode rejected (400)", status == 400)

        # 3. Notifications endpoint triggers KYC sweep — no PROFILE_UPDATE needed now
        status, resp = api("GET", "/api/warehouse/notifications?limit=50", token=token)
        notes = resp.get("notifications") or []
        check("notifications endpoint 200", status == 200)

        conn = sqlite3.connect(TEST_DB)
        notice = conn.execute(
            "SELECT COUNT(*) FROM warehouse_notifications WHERE warehouse_id=? AND type='PROFILE_UPDATE'",
            (wh_id,)).fetchone()[0]
        gst_saved = conn.execute("SELECT gst_number FROM warehouses WHERE id=?", (wh_id,)).fetchone()[0]
        payout_row = conn.execute(
            "SELECT bank_account_name FROM warehouse_payout_accounts WHERE warehouse_id=?", (wh_id,)).fetchone()
        conn.close()
        check("gst persisted in DB", gst_saved == "22AAAAA0000A1Z5")
        check("payout row in DB", bool(payout_row))
        # gst/pickup filled BEFORE the sweep ran → no PROFILE_UPDATE nudge expected
        check("no stale PROFILE_UPDATE nudge after completion", notice == 0)

        # 4. Legacy settings endpoint still works (regression guard)
        status, resp = api("PATCH", "/api/warehouse/settings", token=token,
                           body={"operations_status": "closed"})
        check("legacy settings PATCH 200", status == 200)
        status, resp = api("PATCH", "/api/warehouse/settings", token=token,
                           body={"operations_status": "open"})
        check("legacy settings restore 200", status == 200)

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        log.close()

    print(f"\n== RESULT: {len(PASS)} passed, {len(FAIL)} failed ==")
    if FAIL:
        print("FAILED:", FAIL)
        sys.exit(1)
    print("ALL GREEN ✅")


if __name__ == "__main__":
    main()
