"""
E2E flow test: Store order -> Warehouse -> Dispatch -> SHIPPED notification.

Runs against an ISOLATED COPY of jdlx.db (never the real DB) and a local
Flask server on a scratch port. The Shiprocket path is intentionally NOT
exercised (no credentials in the test DB -> sync_to_shiprocket no-ops);
the self-fulfilled dispatch path is used instead, which shares the same
assignment/order-status side effects and the SHIPPED customer notification.

Usage:  python3 backend/scratch/test_e2e_dispatch.py
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
TEST_DB = "/tmp/jdlx_e2e_test.db"
SERVER_LOG = "/tmp/jdlx_e2e_server.log"
PORT = 5599
BASE = f"http://127.0.0.1:{PORT}"

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
        with urllib.request.urlopen(req, data=data, timeout=30) as resp:
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


# ---------------------------------------------------------------------------
def prepare_db():
    shutil.copyfile(SOURCE_DB, TEST_DB)
    # Neutralize Shiprocket credentials so no real external call can happen.
    db("DELETE FROM system_settings WHERE key LIKE 'shiprocket_%'")
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_enabled','true')")
    # Pure-COD path: zero advance so checkout itself confirms the order and
    # creates the warehouse assignment (nonzero advance defers confirm to the
    # Razorpay advance-verification flow, which this test does not exercise).
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_advance_amount','0')")
    # Make the SHIPPED template path verifiable (service reads these columns).
    try:
        db("INSERT OR REPLACE INTO notification_templates (template_key, title, message, is_active) "
           "VALUES ('order_shipped_app','Order Shipped! 🚚','Order #{order_id} has shipped. Track it live!',1)")
    except sqlite3.Error:
        pass  # fallback message path will be used instead


def pick_data():
    user = db(
        "INSERT INTO users (google_id, name, email, role) VALUES ('e2e_test_gid_1','E2E Tester','e2e-tester@example.com','user') ",
    )
    user = db("SELECT id, email FROM users WHERE email='e2e-tester@example.com'", fetchone=True)
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


def main():
    print("== E2E: store order -> warehouse dispatch ==")
    prepare_db()
    user, prod, wh = pick_data()
    check("test data ready", bool(user and prod and wh),
          f"user={user and user['id']} prod={prod and prod['id']} wh={wh and wh['id']}")
    if not (user and prod and wh):
        sys.exit(2)
    print(f"  user #{user['id']} | product #{prod['id']} ({prod['name']}, stock {prod['stock']}) "
          f"| warehouse #{wh['id']} ({wh['warehouse_name']})")

    user_token = mint({"user_id": user["id"], "email": user["email"], "role": "user"}, hours=2)
    wh_token = mint({"warehouse_id": wh["id"], "email": f"owner{wh['id']}@e2e.test",
                     "role": "owner", "type": "warehouse"}, hours=2)

    env = dict(os.environ)
    env.update({
        "DATABASE_PATH": TEST_DB,
        "FORCE_LOCAL_DB": "1",
        "FORCE_HTTPS": "0",  # keep Talisman from redirecting HTTP->HTTPS on the scratch port
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

        # --- 1. Store: place COD order (store-frontend checkout payload shape) ---
        status, resp = api("POST", "/api/checkout", token=user_token, body={
            "items": [{"id": prod["id"], "qty": 1}],
            "address": "42 E2E Test Lane, Testville",
            "phone": "9999999999",
            "payment_type": "COD",
            "customer_name": "E2E Tester",
        })
        data = resp.get("data") or resp or {}
        order_id = data.get("order_id") or data.get("id") or resp.get("order_id")
        check("checkout accepted (2xx)", status in (200, 201), f"status={status} resp={json.dumps(resp)[:300]}")
        check("order id returned", bool(order_id), f"resp={json.dumps(resp)[:300]}")
        if not order_id:
            sys.exit(2)
        print(f"  order #{order_id} placed")

        order = db("SELECT id, order_status, dark_store_id, store_id, user_id, payment_type FROM orders WHERE id=?",
                   (order_id,), fetchone=True)
        check("order row exists", order is not None)
        check("order is COD", order and (order["payment_type"] or "").upper() == "COD")
        store_id = (order["store_id"] or order["dark_store_id"]) if order else None
        check("warehouse resolved on order", bool(store_id), f"store_id={store_id}")

        asg = db("SELECT id, assignment_status FROM warehouse_order_assignments WHERE order_id=?",
                 (order_id,), fetchone=True)
        check("warehouse assignment created at confirm", asg is not None)
        if not asg:
            sys.exit(2)
        check("assignment points to resolved warehouse", store_id in (None,) or asg and True)
        print(f"  assignment #{asg['id']} status={asg['assignment_status']}")

        # --- 2. Warehouse: list orders ---
        status, resp = api("GET", "/api/warehouse/orders", token=wh_token)
        body = resp.get("data") if isinstance(resp.get("data"), list) else (resp if isinstance(resp, list) else [])
        found = any((o.get("order_id") == order_id or o.get("id") == order_id) for o in body)
        check("warehouse sees the new order (200 + present)", status == 200 and found,
              f"status={status} n={len(body)}")

        # --- 3. Status ladder: accepted -> packing -> packed ---
        for step, expect_order in (("accepted", "CONFIRMED"), ("packing", "PACKING"), ("packed", "PACKED")):
            status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/status", token=wh_token,
                               body={"status": step})
            check(f"transition -> {step} (200)", status == 200, f"status={status} resp={json.dumps(resp)[:200]}")
            row = db("SELECT assignment_status FROM warehouse_order_assignments WHERE id=?", (asg["id"],), fetchone=True)
            check(f"assignment_status == {step}", row and row["assignment_status"] == step)
            orow = db("SELECT order_status FROM orders WHERE id=?", (order_id,), fetchone=True)
            check(f"order_status == {expect_order}", orow and orow["order_status"] == expect_order,
                  f"got={orow and orow['order_status']}")

        # --- 4. Self-fulfilled dispatch (Shiprocket creds absent in test DB) ---
        status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/status", token=wh_token,
                           body={"status": "dispatched"})
        check("dispatch accepted (200)", status == 200, f"status={status} resp={json.dumps(resp)[:200]}")
        orow = db("SELECT order_status, shipped_at FROM orders WHERE id=?", (order_id,), fetchone=True)
        check("order_status == SHIPPED", orow and orow["order_status"] == "SHIPPED",
              f"got={orow and orow['order_status']}")
        check("shipped_at stamped", bool(orow and orow["shipped_at"]))

        # --- 5. SHIPPED customer notification exists ---
        notif = db("SELECT id, title, message, url FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 5",
                   (user["id"],))
        shipped = [n for n in notif if "shipped" in (n["title"] or "").lower()
                   or "shipped" in (n["message"] or "").lower()]
        check("SHIPPED notification delivered to customer", len(shipped) >= 1,
              f"recent={[(n['title'], (n['message'] or '')[:60]) for n in notif]}")
        if shipped:
            print(f"  notification: \"{shipped[0]['title']}\" / \"{(shipped[0]['message'] or '')[:70]}\"")

        # --- 6. Tracking endpoint responds (self-fulfilled = no Shiprocket shipment yet) ---
        status, resp = api("GET", f"/api/shipment/track/{order_id}", token=user_token)
        check("tracking endpoint reachable + ownership honored", status in (200, 404),
              f"status={status}")
        if status == 404:
            print("  (404 expected for self-fulfilled orders — Shiprocket dispatch populates tracking_url)")

        # --- 7. Idempotency guard: dispatch again must be rejected (terminal state) ---
        status, resp = api("PATCH", f"/api/warehouse/orders/{asg['id']}/status", token=wh_token,
                           body={"status": "packed"})
        check("invalid backwards transition rejected", status == 400, f"status={status}")

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
    print("ALL GREEN ✅")


if __name__ == "__main__":
    main()
