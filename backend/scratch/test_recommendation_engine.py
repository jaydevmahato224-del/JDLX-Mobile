"""
E2E test: Smart Recommendation Engine wiring through the warehouse API.

Runs against an ISOLATED COPY of jdlx.db and a local Flask server on a
scratch port (same harness as test_e2e_dispatch.py). Verifies:

  1. Product create auto-fills all four recommendation types (engine path)
  2. PATCH with empty recommendations lists does NOT wipe existing rows
     (regression test for the update-wipe hazard)
  3. PATCH with a NON-EMPTY list = manual mapping (wins over engine)
  4. Manual mapping survives subsequent empty-list PATCHes
  5. List endpoint (GET /api/warehouse/inventory) unaffected
  6. Product detail recommendation_controls still reads from the same table

Usage:  python3 backend/scratch/test_recommendation_engine.py
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
TEST_DB = "/tmp/jdlx_rec_e2e.db"
SERVER_LOG = "/tmp/jdlx_rec_e2e_server.log"
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
    print("FAIL: JWT_SECRET not found in backend/.env")
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


def rec_rows(product_id, rec_type=None):
    q = "SELECT recommended_product_id, recommendation_type FROM product_recommendations WHERE product_id = ?"
    params = [product_id]
    if rec_type:
        q += " AND recommendation_type = ?"
        params.append(rec_type)
    return db(q, params)


def main():
    print("== E2E: smart recommendation engine ==")
    shutil.copyfile(SOURCE_DB, TEST_DB)

    # Seed two same-category fixtures so 'upsell' (1.15x-3x price band) and
    # 'related' have deterministic candidates in the anchor's category.
    cat = db("SELECT id, name FROM categories ORDER BY id LIMIT 1", fetchone=True)
    cat_id, cat_name = cat["id"], cat["name"]
    conn = sqlite3.connect(TEST_DB)
    conn.execute(
        "INSERT INTO products (name, price, category, category_id, status, stock) VALUES (?,?,?,?,?,?)",
        ("RecFixture Low", 500.0, cat_name, cat_id, "available", 40))
    conn.execute(
        "INSERT INTO products (name, price, category, category_id, status, stock) VALUES (?,?,?,?,?,?)",
        ("RecFixture High", 1200.0, cat_name, cat_id, "available", 40))
    conn.commit()
    conn.close()

    # Pick an open+active warehouse and mint an owner token for it.
    wh = db("SELECT id, warehouse_name FROM warehouses WHERE operations_status='open' AND account_status='active' ORDER BY id LIMIT 1", fetchone=True)
    if not wh:
        print("FAIL: no active warehouse in seed DB")
        sys.exit(1)
    token = jwt.encode(
        {
            "warehouse_id": wh["id"],
            "email": "e2e-rec@warehouse.test",
            "role": "owner",
            "type": "warehouse",
            "iat": datetime.datetime.utcnow(),
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=2),
        },
        JWT_SECRET, algorithm="HS256",
    )
    print(f"  warehouse #{wh['id']} ({wh['warehouse_name']})")

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

        # --- 1. Create a product (no recommendations in payload) ---
        payload = {
            "name": "E2E Rec Engine Product",
            "description": "Engine test product",
            "price": 499.0,
            "mrp": 999.0,
            "category": cat_name,
            "category_id": cat_id,
            "sku": f"E2E-REC-{int(time.time())}",
            "stock_quantity": 25,
            "images": [],
            "lifecycle_state": "live",
        }
        status, resp = api("POST", "/api/warehouse/products", token=token, body=payload)
        check("create product (201)", status in (200, 201), f"status={status} resp={json.dumps(resp)[:200]}")
        new_pid = None
        data = resp.get("data") or {}
        new_pid = data.get("product_id") or data.get("id")
        if not new_pid:
            row = db("SELECT id FROM products WHERE name='E2E Rec Engine Product'", fetchone=True)
            new_pid = row["id"] if row else None
        check("product created in DB", new_pid is not None, f"pid={new_pid}")

        types = {r["recommendation_type"] for r in rec_rows(new_pid)}
        check("engine filled all 4 types on create",
              {"related", "upsell", "cross_sell", "frequent"} <= types, f"types={types}")
        related = rec_rows(new_pid, "related")
        fixture_ids = {r["id"] for r in db("SELECT id FROM products WHERE name LIKE 'RecFixture%'")}
        check("related picks exist", len(related) > 0)
        check("related includes same-category fixtures",
              fixture_ids & {r["recommended_product_id"] for r in related} != set(),
              f"related={[(r['recommended_product_id']) for r in related]}")
        upsell_ids = {r["recommended_product_id"] for r in rec_rows(new_pid, "upsell")}
        high = db("SELECT id FROM products WHERE name='RecFixture High'", fetchone=True)
        check("upsell picks the pricier same-category fixture",
              high["id"] in upsell_ids, f"upsell={upsell_ids}")
        check("engine excludes self", all(r["recommended_product_id"] != new_pid for r in rec_rows(new_pid)))

        # --- 2. PATCH with empty recommendations -> NO wipe (regression) ---
        inv = db("SELECT id FROM warehouse_inventory WHERE product_id=? AND warehouse_id=?",
                 (new_pid, wh["id"]), fetchone=True)
        item_id = inv["id"]
        check("inventory item auto-created for product", item_id is not None)
        before = {(r["recommended_product_id"], r["recommendation_type"]) for r in rec_rows(new_pid)}
        status, resp = api("PATCH", f"/api/warehouse/inventory/{item_id}", token=token,
                           body={"description": "updated desc", "recommendations": {"related": [], "upsell": [], "cross_sell": [], "frequent": []}})
        check("PATCH with empty rec lists (200)", status == 200, f"status={status} resp={json.dumps(resp)[:150]}")
        after = {(r["recommended_product_id"], r["recommendation_type"]) for r in rec_rows(new_pid)}
        check("empty-list PATCH did not wipe engine rows", before <= after,
              f"before={len(before)} after={len(after)}")
        check("PATCH updated description", db("SELECT description FROM products WHERE id=?", (new_pid,), fetchone=True)["description"] == "updated desc")

        # --- 3. PATCH with NON-EMPTY list -> manual mapping wins ---
        # (a real panel save also carries normal fields alongside recommendations)
        other = db("SELECT id FROM products WHERE id NOT IN (?, ?) AND status='available' ORDER BY id LIMIT 1",
                   (new_pid, high["id"]), fetchone=True)
        manual_id = other["id"]
        status, resp = api("PATCH", f"/api/warehouse/inventory/{item_id}", token=token,
                           body={"description": "manual mapped", "recommendations": {"related": [manual_id]}})
        check("PATCH with manual list (200)", status == 200, f"status={status}")
        manual_rows = rec_rows(new_pid, "related")
        check("manual mapping replaced related type",
              len(manual_rows) == 1 and manual_rows[0]["recommended_product_id"] == manual_id,
              f"rows={[(r['recommended_product_id']) for r in manual_rows]}")
        # other types untouched
        upsell = rec_rows(new_pid, "upsell")
        check("other types untouched by manual PATCH", len(upsell) > 0)

        # --- 4. Manual mapping survives subsequent empty-list PATCH ---
        status, resp = api("PATCH", f"/api/warehouse/inventory/{item_id}", token=token,
                           body={"description": "desc again", "recommendations": {"related": []}})
        manual_survives = rec_rows(new_pid, "related")
        check("manual mapping survives empty-list PATCH",
              len(manual_survives) == 1 and manual_survives[0]["recommended_product_id"] == manual_id,
              f"rows={[(r['recommended_product_id']) for r in manual_survives]}")

        # --- 5. List endpoint unaffected ---
        # (this endpoint returns a top-level JSON array)
        status, resp = api("GET", "/api/warehouse/inventory", token=token)
        items = resp if isinstance(resp, list) else []
        check("GET inventory (200)", status == 200 and len(items) > 0, f"status={status} items={len(items)}")

        # --- 6. Product detail recommendation_controls still works ---
        status, resp = api("GET", f"/api/products/{new_pid}")
        ctrl = ((resp.get("data") or {}).get("product") or {}).get("recommendation_controls") or {}
        if not ctrl:
            ctrl = (resp.get("data") or {}).get("recommendation_controls") or {}
        check("detail endpoint serves recommendation_controls",
              status == 200 and isinstance(ctrl.get("related"), list) and len(ctrl.get("related", [])) > 0,
              f"status={status} keys={list(ctrl.keys())[:6]}")

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


if __name__ == "__main__":
    main()
