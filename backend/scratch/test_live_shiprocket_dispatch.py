"""
LIVE e2e: Store order -> warehouse packed -> REAL Shiprocket dispatch.

Same isolated-DB approach as scratch/test_e2e_dispatch.py (never touches the
real DB), but the Shiprocket path is exercised FOR REAL: the spawned server
loads backend/.env, and the dispatch PATCH hits apiv2.shiprocket.in to create
the order, assign a courier and generate an AWB.

Run this AFTER fixing SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD (env or .env).
It intentionally performs only ONE Shiprocket dispatch attempt per run —
repeated failed logins get the Shiprocket account temporarily blocked, so
do NOT loop this script.

Usage:  python3 backend/scratch/test_live_shiprocket_dispatch.py
"""
import datetime
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

import jwt

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_DB = os.path.join(BACKEND_DIR, "jdlx.db")
TEST_DB = "/tmp/jdlx_live_sr_test.db"
SERVER_LOG = "/tmp/jdlx_live_sr_server.log"
PORT = 5598
BASE = f"http://127.0.0.1:{PORT}"

# Realistic address WITH pincode — Shiprocket needs it for serviceability.
TEST_ADDRESS = "42 E2E Test Lane, Connaught Place, New Delhi - 110001"

# Read the dev JWT secret from .env (keys only — never printed).
JWT_SECRET = None
_env_path = os.path.join(BACKEND_DIR, ".env")
if os.path.exists(_env_path):
    for line in open(_env_path):
        if line.strip().startswith("JWT_SECRET="):
            JWT_SECRET = line.split("=", 1)[1].strip().strip('"').strip("'")
            break
if not JWT_SECRET:
    print("FAIL: JWT_SECRET not found in backend/.env — cannot mint test tokens")
    sys.exit(1)

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  ({detail})" if detail and not cond else ""))


def db(query, params=(), fetchone=False):
    conn = sqlite3.connect(TEST_DB)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(query, params)
    rows = cur.fetchall()
    conn.commit()
    conn.close()
    return (rows[0] if rows else None) if fetchone else rows


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
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def mint(payload_extra, hours=8):
    now = datetime.datetime.utcnow()
    payload = {"iat": now, "jti": secrets_hex(), "exp": now + datetime.timedelta(hours=hours)}
    payload.update(payload_extra)
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def secrets_hex():
    import secrets
    return secrets.token_hex(16)


def prepare_db():
    shutil.copyfile(SOURCE_DB, TEST_DB)
    # Pure-COD path: zero advance so checkout confirms the order and creates
    # the warehouse assignment without the Razorpay advance flow.
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_advance_amount','0')")
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_enabled','true')")
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_enabled_shiprocket','true')")


def pick_data():
    user = db(
        "INSERT INTO users (google_id, name, email, role) VALUES ('live_sr_gid_1','Live SR Tester','live-sr-tester@example.com','user') ",
    )
    user = db("SELECT id, email FROM users WHERE email='live-sr-tester@example.com'", fetchone=True)
    prod = db(
        "SELECT id, name, price, stock FROM products WHERE stock >= 5 AND (prepaid_only = 0 OR prepaid_only IS NULL) "
        "ORDER BY id LIMIT 1", fetchone=True)
    wh = db("SELECT id, warehouse_name FROM warehouses WHERE operations_status='open' AND account_status='active' "
            "ORDER BY id LIMIT 1", fetchone=True)
    return user, prod, wh


def wait_for_server(proc, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            status, _ = api("GET", "/")
            if status == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def sr_login_reject_reason():
    """Pull the Shiprocket auth reject reason out of the server log (if any)."""
    try:
        for line in open(SERVER_LOG, errors="ignore"):
            if "Shiprocket login rejected" in line or "SHIPROCKET_EMAIL or SHIPROCKET_PASSWORD not set" in line:
                return line.strip().split(" - ")[-1]
    except Exception:
        pass
    return None


def main():
    print("== LIVE e2e: store order -> warehouse packed -> REAL Shiprocket dispatch ==")
    prepare_db()
    user, prod, wh = pick_data()
    check("test data ready", bool(user and prod and wh),
          f"user={user and user['id']} prod={prod and prod['id']} wh={wh and wh['id']}")
    if not (user and prod and wh):
        sys.exit(2)
    print(f"  user #{user['id']} | product #{prod['id']} ({prod['name']}) | warehouse #{wh['id']} ({wh['warehouse_name']})")

    user_token = mint({"user_id": user["id"], "email": user["email"], "role": "user"}, hours=2)
    wh_token = mint({"warehouse_id": wh["id"], "email": f"owner{wh['id']}@e2e.test",
                     "role": "owner", "type": "warehouse"}, hours=2)

    env = dict(os.environ)
    env.update({
        "DATABASE_PATH": TEST_DB,
        "FORCE_LOCAL_DB": "1",
        "FORCE_HTTPS": "0",
        "PORT": str(PORT),
        "DISABLE_RATE_LIMIT": "1",
        "FLASK_DEBUG": "",
    })
    log = open(SERVER_LOG, "w")
    proc = subprocess.Popen([sys.executable, os.path.join(BACKEND_DIR, "app.py")],
                            cwd=BACKEND_DIR, env=env, stdout=log, stderr=log,
                            start_new_session=True)
    try:
        check("server started", wait_for_server(proc))

        # --- 1. Store: place COD order with a pincode-bearing address ---
        status, resp = api("POST", "/api/checkout", token=user_token, body={
            "items": [{"id": prod["id"], "qty": 1}],
            "address": TEST_ADDRESS,
            "phone": "8447039921",
            "payment_type": "COD",
            "customer_name": "Live SR Tester",
        })
        data = resp.get("data") or resp or {}
        order_id = data.get("order_id") or data.get("id") or resp.get("order_id")
        check("checkout accepted (2xx)", status in (200, 201), f"status={status} resp={json.dumps(resp)[:300]}")
        check("order id returned", bool(order_id), f"resp={json.dumps(resp)[:300]}")
        if not order_id:
            sys.exit(2)
        print(f"  order #{order_id} placed ({TEST_ADDRESS})")

        asg = db("SELECT id, assignment_status FROM warehouse_order_assignments WHERE order_id=?",
                 (order_id,), fetchone=True)
        check("warehouse assignment created at confirm", asg is not None)
        if not asg:
            sys.exit(2)
        print(f"  assignment #{asg['id']} status={asg['assignment_status']}")

        # --- 2. Status ladder: accepted -> packing -> packed ---
        for step in ("accepted", "packing", "packed"):
            status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/status", token=wh_token,
                               body={"status": step})
            check(f"transition -> {step} (200)", status == 200, f"status={status} resp={json.dumps(resp)[:200]}")

        # --- 3. REAL Shiprocket dispatch (the one and only SR attempt) ---
        print("\n  --> calling PATCH /dispatch (real Shiprocket: create order + assign courier + AWB)...")
        status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/dispatch", token=wh_token,
                           body={"weight_kg": 0.5})
        body = json.dumps(resp)
        print(f"  dispatch HTTP {status}: {body[:500]}")

        if status != 200:
            err = resp.get("error") or resp.get("message") or "?"
            print(f"\n  !! Dispatch failed: {err}")
            reject = sr_login_reject_reason()
            if reject:
                print(f"  !! Server log says: {reject}")
            if "not configured" in str(err):
                print("  !! Fix SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD (env or backend/.env) and re-run ONCE.")
            sys.exit(1)

        d = resp.get("data") or {}
        check("dispatch 200 with AWB", bool(d.get("awb_code")), f"awb={d.get('awb_code')}")
        check("courier assigned", bool(d.get("courier_name")), f"courier={d.get('courier_name')}")
        check("tracking URL present", bool(d.get("tracking_url")), f"url={d.get('tracking_url')}")
        check("SR order id returned", bool(d.get("shiprocket_order_id")), f"sr={d.get('shiprocket_order_id')}")
        print(f"\n  AWB: {d.get('awb_code')} | Courier: {d.get('courier_name')}")
        print(f"  Tracking: {d.get('tracking_url')}")

        # --- 4. DB side effects ---
        row = db("SELECT order_status, shipped_at FROM orders WHERE id=?", (order_id,), fetchone=True)
        check("order_status == SHIPPED", row and row["order_status"] == "SHIPPED",
              f"got={row and row['order_status']}")
        check("shipped_at stamped", bool(row and row["shipped_at"]))

        asg_row = db("SELECT assignment_status FROM warehouse_order_assignments WHERE id=?", (asg["id"],), fetchone=True)
        check("assignment_status == dispatched", asg_row and asg_row["assignment_status"] == "dispatched",
              f"got={asg_row and asg_row['assignment_status']}")

        ship = db("SELECT shiprocket_order_id, shiprocket_shipment_id, awb_code, courier_name, tracking_url, status "
                  "FROM shipments WHERE order_id=?", (order_id,), fetchone=True)
        check("shipments row populated", ship is not None and bool(ship["awb_code"]),
              f"ship={dict(ship) if ship else None}")
        if ship:
            print(f"  shipments row: status={ship['status']} awb={ship['awb_code']} courier={ship['courier_name']}")

        # --- 5. Idempotency: repeat dispatch returns stored AWB, no duplicate ---
        status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/dispatch", token=wh_token,
                           body={"weight_kg": 0.5})
        d2 = resp.get("data") or {}
        check("idempotent re-dispatch returns same AWB (200)",
              status == 200 and d2.get("awb_code") == d.get("awb_code"),
              f"status={status} awb={d2.get('awb_code')}")

        # --- 6. Customer SHIPPED notification ---
        notif = db("SELECT id, title, message FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 5",
                   (user["id"],))
        shipped = [n for n in notif if "shipped" in (n["title"] or "").lower()
                   or "shipped" in (n["message"] or "").lower()]
        check("SHIPPED notification delivered to customer", len(shipped) >= 1,
              f"recent={[(n['title'], (n['message'] or '')[:60]) for n in notif]}")

    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except Exception:
            proc.terminate()
        proc.wait(timeout=15)
        log.close()

    print(f"\n== RESULT: {len(PASS)} passed, {len(FAIL)} failed ==")
    if FAIL:
        print("Failed checks:", *FAIL, sep="\n  - ")
        print(f"Server log tail: {SERVER_LOG}")
        sys.exit(1)
    print("ALL GREEN ✅  — real Shiprocket order created, AWB generated, customer notified.")


if __name__ == "__main__":
    main()
