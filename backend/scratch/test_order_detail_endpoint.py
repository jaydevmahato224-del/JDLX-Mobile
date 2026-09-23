"""
E2E test for GET /api/warehouse/orders/<assignment_id> (order detail endpoint).

Runs against an ISOLATED COPY of jdlx.db and a local Flask server on a
scratch port (same harness as test_e2e_dispatch.py). Verifies:
  1. Detail returns 200 with full order + items + payment for own assignment
  2. Security scoping: another warehouse's token gets 404
  3. Unknown assignment id gets 404
  4. Unauthenticated request gets 401
  5. Detail works at every step of the status ladder (assigned -> dispatched)
  6. Payload shape: items array with product names, total_quantity, tracking fields

Usage:  python3 backend/scratch/test_order_detail_endpoint.py
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
TEST_DB = "/tmp/jdlx_detail_test.db"
SERVER_LOG = "/tmp/jdlx_detail_server.log"
PORT = 5598
BASE = f"http://127.0.0.1:{PORT}"

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
    now = datetime.datetime.now(datetime.UTC)
    import secrets
    payload = {"iat": now, "jti": secrets.token_hex(16), "exp": now + datetime.timedelta(hours=hours)}
    payload.update(payload_extra)
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def prepare_db():
    shutil.copyfile(SOURCE_DB, TEST_DB)
    db("DELETE FROM system_settings WHERE key LIKE 'shiprocket_%'")
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_enabled','true')")
    db("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('cod_advance_amount','0')")


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
    print("== E2E: warehouse order detail endpoint ==")
    prepare_db()

    user = db(
        "INSERT INTO users (google_id, name, email, role) VALUES ('detail_test_gid_1','Detail Tester','detail-tester@example.com','user') ",
    )
    user = db("SELECT id, email FROM users WHERE email='detail-tester@example.com'", fetchone=True)
    prod = db(
        "SELECT id, name, price, stock FROM products WHERE stock >= 5 AND (prepaid_only = 0 OR prepaid_only IS NULL) "
        "ORDER BY id LIMIT 1", fetchone=True)
    wh = db("SELECT id, warehouse_name FROM warehouses WHERE operations_status='open' AND account_status='active' "
            "ORDER BY id LIMIT 1", fetchone=True)
    other_wh = db("SELECT id, warehouse_name FROM warehouses WHERE operations_status='open' AND account_status='active' "
                  "AND id != ? ORDER BY id LIMIT 1", (wh["id"] if wh else 0,), fetchone=True)
    check("test data ready", bool(user and prod and wh),
          f"user={user and user['id']} prod={prod and prod['id']} wh={wh and wh['id']}")
    if not (user and prod and wh):
        sys.exit(2)
    print(f"  user #{user['id']} | product #{prod['id']} | warehouse #{wh['id']} | other warehouse: {other_wh['id'] if other_wh else 'NONE'}")

    user_token = mint({"user_id": user["id"], "email": user["email"], "role": "user"}, hours=2)
    wh_token = mint({"warehouse_id": wh["id"], "email": f"owner{wh['id']}@e2e.test",
                     "role": "owner", "type": "warehouse"}, hours=2)
    other_token = None
    if other_wh:
        other_token = mint({"warehouse_id": other_wh["id"], "email": f"owner{other_wh['id']}@e2e.test",
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

        # --- Place an order so an assignment exists ---
        status, resp = api("POST", "/api/checkout", token=user_token, body={
            "items": [{"id": prod["id"], "qty": 2}],
            "address": "99 Detail Test Lane, Testville",
            "phone": "9887766554",
            "payment_type": "COD",
            "customer_name": "Detail Tester",
        })
        data = resp.get("data") or resp or {}
        order_id = data.get("order_id") or data.get("id") or resp.get("order_id")
        check("checkout accepted (2xx)", status in (200, 201), f"status={status}")
        if not order_id:
            sys.exit(2)

        asg = db("SELECT id, assignment_status FROM warehouse_order_assignments WHERE order_id=?",
                 (order_id,), fetchone=True)
        check("assignment exists", asg is not None)
        if not asg:
            sys.exit(2)
        print(f"  order #{order_id} | assignment #{asg['id']} status={asg['assignment_status']}")

        # --- 1. Unauthenticated request -> 401 ---
        status, resp = api("GET", f"/api/warehouse/orders/{asg['id']}")
        check("unauthenticated detail request rejected (401)", status == 401, f"status={status}")

        # --- 2. Own assignment -> 200 with full payload ---
        status, resp = api("GET", f"/api/warehouse/orders/{asg['id']}", token=wh_token)
        check("detail returns 200 for own assignment", status == 200, f"status={status} resp={json.dumps(resp)[:200]}")
        detail = resp.get("data") or {}
        check("detail has order_id", detail.get("order_id") == order_id)
        check("detail has customer_name", detail.get("customer_name") == "Detail Tester",
              f"got={detail.get('customer_name')}")
        check("detail has phone", bool(detail.get("phone") or detail.get("customer_phone")))
        check("detail has delivery_address", "Detail Test Lane" in (detail.get("delivery_address") or ""),
              f"got={detail.get('delivery_address')}")
        check("detail has total_amount > 0", Number_gt(detail.get("total_amount"), 0),
              f"got={detail.get('total_amount')}")
        check("detail has payment_type COD", (detail.get("payment_type") or "").upper() == "COD",
              f"got={detail.get('payment_type')}")
        check("detail has payment_status", bool(detail.get("payment_status")))
        check("detail has items array", isinstance(detail.get("items"), list) and len(detail["items"]) >= 1,
              f"items={len(detail.get('items') or [])}")
        if detail.get("items"):
            item = detail["items"][0]
            check("item has product_name", bool(item.get("product_name")), f"got={item.get('product_name')}")
            check("item has quantity >= 1", Number_gte(item.get("quantity"), 1), f"got={item.get('quantity')}")
            check("item has price", Number_gt(item.get("price"), 0), f"got={item.get('price')}")
        check("detail has total_quantity == 2", detail.get("total_quantity") == 2,
              f"got={detail.get('total_quantity')}")
        check("detail has assignment_status", detail.get("assignment_status") == "assigned")
        check("detail has created_at", bool(detail.get("created_at")))
        # Tracking fields present (even if null pre-dispatch)
        for key in ("awb_code", "courier_name", "tracking_url", "shipment_status"):
            check(f"detail has {key} field", key in detail)

        # --- 3. Security scoping: another warehouse gets 404 ---
        if other_token:
            status, resp = api("GET", f"/api/warehouse/orders/{asg['id']}", token=other_token)
            check("other warehouse gets 404 (scoping enforced)", status == 404, f"status={status}")
        else:
            print("  [SKIP] other-warehouse scoping (only one open warehouse in DB)")

        # --- 4. Unknown id -> 404 ---
        status, resp = api("GET", "/api/warehouse/orders/999999", token=wh_token)
        check("unknown assignment id gets 404", status == 404, f"status={status}")

        # --- 5. Detail works at every step of the status ladder ---
        ladder_ok = True
        for step, expect_order in (("accepted", "CONFIRMED"), ("packing", "PACKING"), ("packed", "PACKED"),
                                   ("dispatched", "SHIPPED")):
            s, r = api("PATCH", f"/api/warehouse/orders/{asg['id']}/status", token=wh_token,
                       body={"status": step})
            if s != 200:
                ladder_ok = False
                check(f"ladder transition -> {step}", False, f"status={s} resp={json.dumps(r)[:150]}")
                break
            s, r = api("GET", f"/api/warehouse/orders/{asg['id']}", token=wh_token)
            d = (r.get("data") or {})
            if s != 200 or d.get("assignment_status") != step:
                ladder_ok = False
                check(f"detail reflects status {step}", False,
                      f"status={s} got={d.get('assignment_status')}")
                break
        check("detail reflects assignment_status at every ladder step", ladder_ok)

        # Post-dispatch: order_status should be SHIPPED in detail payload
        status, resp = api("GET", f"/api/warehouse/orders/{asg['id']}", token=wh_token)
        detail = resp.get("data") or {}
        check("post-dispatch order_status == SHIPPED", (detail.get("order_status") or "").upper() == "SHIPPED",
              f"got={detail.get('order_status')}")
        check("post-dispatch shipped_at stamped", bool(detail.get("shipped_at")))

        # List endpoint still returns the order (no regression)
        status, resp = api("GET", "/api/warehouse/orders", token=wh_token)
        body = resp.get("data") if isinstance(resp.get("data"), list) else []
        found = any(o.get("id") == asg["id"] for o in body)
        check("list endpoint still lists the order (no regression)", status == 200 and found,
              f"status={status} n={len(body)}")

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        log.close()

    print(f"\n== RESULT: {len(PASS)} passed, {len(FAIL)} failed ==")
    if FAIL:
        for f in FAIL:
            print(f"  FAILED: {f}")
        sys.exit(1)
    print("ALL GREEN ✅")


def Number_gt(v, n):
    try:
        return float(v) > n
    except (TypeError, ValueError):
        return False


def Number_gte(v, n):
    try:
        return float(v) >= n
    except (TypeError, ValueError):
        return False


if __name__ == "__main__":
    main()
