"""
E2E verification: Return window (fixed options) + fixed dispatch SLA.
Isolated temp DB — NEVER touches jdlx.db or Turso.
Covers: default 0 (no returns), whitelist enforcement, dispatch SLA clamp,
        storefront policy text (list + detail), legacy fallback for old rows.
Run: FORCE_LOCAL_DB=1 python3 scratch/test_return_window_e2e.py
"""
import os
import sys
import json
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = tempfile.mktemp(suffix=".db")
os.environ["DISABLE_RATE_LIMIT"] = "1"
os.environ["FORCE_HTTPS"] = "0"
os.environ.setdefault("JWT_SECRET", "e2e-test-secret")
os.environ.setdefault("RAZORPAY_KEY_ID", "test")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "test")

passed, failed = [], []


def check(name, ok, extra=""):
    (passed if ok else failed).append(name)
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {extra}")


def main():
    import app as appmod
    from database import get_db

    app = appmod.app
    app.config["TESTING"] = True
    client = app.test_client()

    conn = get_db()
    cur = conn.cursor()

    # Legacy parity: production products tables carry a TEXT `category` column.
    prod_cols = [r[1] for r in cur.execute("PRAGMA table_info(products)").fetchall()]
    if "category" not in prod_cols:
        cur.execute("ALTER TABLE products ADD COLUMN category TEXT")
    conn.commit()

    # ---- Seed ----
    cur.execute("INSERT INTO categories (name) VALUES ('Screen Protector')")
    cat_id = cur.lastrowid
    cur.execute(
        "INSERT INTO users (google_id, name, email, role) VALUES (?, ?, ?, ?)",
        ("g1", "Owner", "wh@test.local", "user"),
    )
    cur.execute(
        """INSERT INTO warehouses (email, owner_name, warehouse_name, google_id, warehouse_role)
           VALUES (?, ?, ?, ?, ?)""",
        ("wh@test.local", "Owner", "Test WH", "gwh1", "owner"),
    )
    wh_id = cur.lastrowid
    conn.commit()

    import jwt as pyjwt
    import datetime

    def wh_token():
        return pyjwt.encode(
            {"warehouse_id": wh_id, "email": "wh@test.local", "role": "owner",
             "type": "warehouse", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1)},
            os.environ["JWT_SECRET"], algorithm="HS256")

    def api(method, path, token=None, payload=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        r = client.open(path, method=method, headers=headers,
                        data=json.dumps(payload) if payload else None,
                        content_type="application/json")
        body = r.get_json()
        if isinstance(body, dict) and "data" in body:
            body = body["data"]
        return r.status_code, body

    base_payload = {
        "category_id": cat_id,
        "stock_quantity": 5,
        "selling_price": 100,
        # The warehouse panel ALWAYS sends a fulfillment object (return_window
        # defaults to 0 = No Returns in the UI). An explicit 0 mirrors that.
        "fulfillment": {"return_window": 0},
    }

    # ---- 1. Default: rw=0 -> row exists with 0 (No Returns) ----
    p = dict(base_payload, name="Default RW", price=100)
    s, r = api("POST", "/api/warehouse/products", wh_token(), p)
    check("create (rw=0): 201", s == 201, f"got {s}")
    pid_default = r.get("product_id")
    row = conn.execute("SELECT return_window, dispatch_sla FROM product_fulfillment WHERE product_id = ?", (pid_default,)).fetchone()
    check("default return_window == 0 (No Returns)", row and row["return_window"] == 0, f"got {row['return_window'] if row else None}")
    check("dispatch_sla clamped to 24", row and row["dispatch_sla"] == 24, f"got {row['dispatch_sla'] if row else None}")

    # Products created with NO fulfillment key get no fulfillment row — that's
    # the pre-existing legacy path; storefront falls back to legacy text.

    # ---- 2. Each allowed option persists exactly ----
    for days, label in [(1, "24 Hours Return Window"), (2, "48 Hours Return Window"), (3, "3 Days Return Policy"), (5, "5 Days Return Policy"), (7, "7 Days Return Policy")]:
        p = dict(base_payload, name=f"RW {days}", price=100, fulfillment={"return_window": days})
        s, r = api("POST", "/api/warehouse/products", wh_token(), p)
        row = conn.execute("SELECT return_window FROM product_fulfillment WHERE product_id = ?", (r.get("product_id"),)).fetchone()
        check(f"allowed rw={days} persists", row and row["return_window"] == days, f"got {row['return_window'] if row else None}")

    # ---- 3. Malicious / free-text values rejected to default ----
    for bad in [4, 6, 10, 24, 30, -3, "abc", None]:
        p = dict(base_payload, name=f"Bad {bad}", price=100, fulfillment={"return_window": bad})
        s, r = api("POST", "/api/warehouse/products", wh_token(), p)
        row = conn.execute("SELECT return_window FROM product_fulfillment WHERE product_id = ?", (r.get("product_id"),)).fetchone()
        check(f"bad rw={bad!r} -> 0", row and row["return_window"] == 0, f"got {row['return_window'] if row else None}")

    # ---- 4. Dispatch SLA tamper attempt ignored ----
    p = dict(base_payload, name="SLA Tamper", price=100, fulfillment={"dispatch_sla": 2, "return_window": 3})
    s, r = api("POST", "/api/warehouse/products", wh_token(), p)
    row = conn.execute("SELECT dispatch_sla FROM product_fulfillment WHERE product_id = ?", (r.get("product_id"),)).fetchone()
    check("dispatch_sla tamper (2h) -> 24", row and row["dispatch_sla"] == 24, f"got {row['dispatch_sla'] if row else None}")

    # ---- 5. PATCH path enforces the same rules ----
    p = dict(base_payload, name="Patch Me", price=100, fulfillment={"return_window": 0})
    s, r = api("POST", "/api/warehouse/products", wh_token(), p)
    check("create (Patch Me): 201", s == 201, f"got {s} {r if s != 201 else ''}")
    pid_patch = r.get("product_id")
    inv_id = conn.execute("SELECT id FROM warehouse_inventory WHERE product_id = ? AND warehouse_id = ?", (pid_patch, wh_id)).fetchone()["id"]
    s, r2 = api("PATCH", f"/api/warehouse/inventory/{inv_id}", wh_token(), {"fulfillment": {"return_window": 5, "dispatch_sla": 99}})
    check("PATCH rw=5: 200", s == 200, f"got {s} {r2 if s != 200 else ''}")
    row = conn.execute("SELECT return_window, dispatch_sla FROM product_fulfillment WHERE product_id = ?", (pid_patch,)).fetchone()
    check("PATCH: rw=5 saved", row["return_window"] == 5, f"got {row['return_window']}")
    check("PATCH: dispatch_sla tamper (99) -> 24", row["dispatch_sla"] == 24, f"got {row['dispatch_sla']}")

    # Storefront list reflects the 5-day window BEFORE the later bad-PATCH resets it
    s, products = api("GET", "/api/products")
    plist = {x["id"]: x for x in (products if isinstance(products, list) else [])}
    check("list: rw=5 product shows 5-day text", plist.get(pid_patch, {}).get("final_return_policy") == "5 Days Return Policy",
          f"got {plist.get(pid_patch, {}).get('final_return_policy')!r}")

    s, _ = api("PATCH", f"/api/warehouse/inventory/{inv_id}", wh_token(), {"fulfillment": {"return_window": 30}})
    row = conn.execute("SELECT return_window FROM product_fulfillment WHERE product_id = ?", (pid_patch,)).fetchone()
    check("PATCH: bad rw=30 -> 0", row["return_window"] == 0, f"got {row['return_window']}")

    # ---- 6. Storefront detail shows correct policy text ----
    p = dict(base_payload, name="Policy Detail", price=100, fulfillment={"return_window": 2})
    s, r = api("POST", "/api/warehouse/products", wh_token(), p)
    pid_detail = r.get("product_id")
    s, detail = api("GET", f"/api/products/{pid_detail}")
    check("detail: 48-hour policy text", detail.get("final_return_policy") == "48 Hours Return Window", f"got {detail.get('final_return_policy')!r}")
    s, detail = api("GET", f"/api/products/{pid_default}")
    check("detail: rw=0 -> 'No Returns'", detail.get("final_return_policy") == "No Returns", f"got {detail.get('final_return_policy')!r}")

    # ---- 7. Storefront list matches detail ----
    s, products = api("GET", "/api/products")
    plist = {x["id"]: x for x in (products if isinstance(products, list) else [])}
    check("list: 48-hour text matches detail", plist.get(pid_detail, {}).get("final_return_policy") == "48 Hours Return Window",
          f"got {plist.get(pid_detail, {}).get('final_return_policy')!r}")
    check("list: 'No Returns' matches detail", plist.get(pid_default, {}).get("final_return_policy") == "No Returns",
          f"got {plist.get(pid_default, {}).get('final_return_policy')!r}")

    # ---- 8. Legacy fallback: product WITHOUT fulfillment row keeps old text ----
    cur.execute(
        """INSERT INTO products (name, price, stock, category_id, status, lifecycle_state)
           VALUES ('Legacy Item', 100, 5, ?, 'available', 'live')""",
        (cat_id,),
    )
    legacy_pid = cur.lastrowid
    conn.commit()
    s, detail = api("GET", f"/api/products/{legacy_pid}")
    pol = (detail or {}).get("final_return_policy")
    check("legacy (no fulfillment row): keeps a policy string", isinstance(pol, str) and len(pol) > 0, f"got {pol!r}")

    conn.close()
    print()
    print(f"RESULT: {len(passed)} passed, {len(failed)} failed")
    if failed:
        print("FAILED:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
