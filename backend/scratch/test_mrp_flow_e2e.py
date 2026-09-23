"""
E2E verification: MRP (strike-through price) flow.
Isolated temp DB — NEVER touches jdlx.db or Turso. Read-only audit tool.
Covers: backfill from warehouse_inventory, warehouse PATCH sync, storefront reads.
Run: FORCE_LOCAL_DB=1 python3 scratch/test_mrp_flow_e2e.py
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

    # Legacy parity: production products tables carry a TEXT `category`
    # column (created before category_id). init_db does not add it on fresh
    # DBs, but /api/products and warehouse create write it. Mirror production.
    prod_cols = [r[1] for r in cur.execute("PRAGMA table_info(products)").fetchall()]
    if "category" not in prod_cols:
        cur.execute("ALTER TABLE products ADD COLUMN category TEXT")
    conn.commit()

    # ---- Seed ----
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

    cur.execute(
        """INSERT INTO categories (name) VALUES ('Screen Protector')"""
    )
    cat_id = cur.lastrowid

    # Product WITHOUT mrp (simulating pre-existing row)
    cur.execute(
        """INSERT INTO products (name, price, stock, category_id, status, lifecycle_state)
           VALUES ('Old Product', 180, 10, ?, 'available', 'live')""",
        (cat_id,),
    )
    old_pid = cur.lastrowid
    # Inventory line WITH mrp saved earlier by the warehouse panel
    cur.execute(
        """INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, sku,
           stock_quantity, available_stock, selling_price, mrp, status)
           VALUES (?, ?, 'Old Product', 'SKU-OLD', 10, 10, 180, 240, 'active')""",
        (wh_id, old_pid),
    )
    old_inv = cur.lastrowid

    # Product WITH mrp already set (must NOT be overwritten by backfill)
    cur.execute(
        """INSERT INTO products (name, price, mrp, stock, category_id, status, lifecycle_state)
           VALUES ('New Product', 100, 150, 5, ?, 'available', 'live')""",
        (cat_id,),
    )
    new_pid = cur.lastrowid
    cur.execute(
        """INSERT INTO warehouse_inventory (warehouse_id, product_id, product_name, sku,
           stock_quantity, available_stock, selling_price, mrp, status)
           VALUES (?, ?, 'New Product', 'SKU-NEW', 5, 5, 100, 999, 'active')""",
        (wh_id, new_pid),
    )
    new_inv = cur.lastrowid
    conn.commit()

    # ---- 1. Backfill correctness: re-run the exact backfill statement from
    # init_db against seeded legacy data (products.mrp empty, inventory has it).
    cur.execute("""
        UPDATE products SET mrp = (
            SELECT wi.mrp FROM warehouse_inventory wi
            WHERE wi.product_id = products.id AND wi.mrp IS NOT NULL AND wi.mrp > 0
            ORDER BY wi.id LIMIT 1
        ) WHERE (mrp IS NULL OR mrp = 0)
    """)
    conn.commit()
    row = conn.execute("SELECT mrp FROM products WHERE id = ?", (old_pid,)).fetchone()
    check("backfill: old product mrp filled from warehouse_inventory (240)", row["mrp"] == 240, f"got {row['mrp']}")
    row = conn.execute("SELECT mrp FROM products WHERE id = ?", (new_pid,)).fetchone()
    check("backfill: existing mrp NOT overwritten (150, not 999)", row["mrp"] == 150, f"got {row['mrp']}")

    # ---- Auth ----
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

    # ---- 2. Storefront list shows mrp now ----
    s, products = api("GET", "/api/products")
    plist = products if isinstance(products, list) else []
    by_id = {p["id"]: p for p in plist}
    check("storefront list: 200", s == 200, f"got {s}")
    check("storefront list: old product mrp == 240", by_id.get(old_pid, {}).get("mrp") == 240,
          f"got {by_id.get(old_pid, {}).get('mrp')}")
    check("storefront list: new product mrp == 150", by_id.get(new_pid, {}).get("mrp") == 150,
          f"got {by_id.get(new_pid, {}).get('mrp')}")

    # ---- 3. Warehouse PATCH updates BOTH tables (mrp + selling_price) ----
    s, r = api("PATCH", f"/api/warehouse/inventory/{old_inv}", wh_token(),
               {"mrp": 260, "selling_price": 199})
    check("warehouse PATCH: 200", s == 200, f"got {s} {r if s != 200 else ''}")
    row = conn.execute("SELECT mrp, selling_price FROM warehouse_inventory WHERE id = ?", (old_inv,)).fetchone()
    check("PATCH: warehouse_inventory.mrp == 260", row["mrp"] == 260, f"got {row['mrp']}")
    row = conn.execute("SELECT mrp, price FROM products WHERE id = ?", (old_pid,)).fetchone()
    check("PATCH: products.mrp synced == 260", row["mrp"] == 260, f"got {row['mrp']}")
    check("PATCH: products.price synced == 199", row["price"] == 199, f"got {row['price']}")

    # Storefront reflects it immediately
    s, products = api("GET", "/api/products")
    by_id = {p["id"]: p for p in (products if isinstance(products, list) else [])}
    check("storefront reflects PATCH: mrp 260 / price 199",
          by_id.get(old_pid, {}).get("mrp") == 260 and by_id.get(old_pid, {}).get("price") == 199,
          f"got mrp={by_id.get(old_pid, {}).get('mrp')} price={by_id.get(old_pid, {}).get('price')}")

    # ---- 4. Stock-only PATCH must NOT touch pricing ----
    s, r = api("PATCH", f"/api/warehouse/inventory/{new_inv}", wh_token(), {"stock_quantity": 7})
    check("stock-only PATCH: 200", s == 200, f"got {s}")
    row = conn.execute("SELECT mrp, price FROM products WHERE id = ?", (new_pid,)).fetchone()
    check("stock-only PATCH: products.mrp untouched (150)", row["mrp"] == 150, f"got {row['mrp']}")
    check("stock-only PATCH: products.price untouched (100)", row["price"] == 100, f"got {row['price']}")

    # ---- 5. Product detail (p.*) exposes mrp ----
    s, detail = api("GET", f"/api/products/{old_pid}")
    check("product detail: mrp present", isinstance(detail, dict) and detail.get("mrp") == 260,
          f"got {detail.get('mrp') if isinstance(detail, dict) else s}")

    # ---- 6. New product creation carries mrp into products ----
    s, r = api("POST", "/api/warehouse/products", wh_token(), {
        "name": "Fresh Item", "price": 50, "mrp": 80,
        "category_id": cat_id, "stock_quantity": 4, "selling_price": 50,
    })
    check("create product: 201", s == 201, f"got {s}")
    created_pid = r.get("product_id") if isinstance(r, dict) else None
    if created_pid:
        row = conn.execute("SELECT mrp, price FROM products WHERE id = ?", (created_pid,)).fetchone()
        check("create product: products.mrp == 80", row and row["mrp"] == 80, f"got {row['mrp'] if row else None}")
        check("create product: products.price == 50", row and row["price"] == 50, f"got {row['price'] if row else None}")

    conn.close()
    print()
    print(f"RESULT: {len(passed)} passed, {len(failed)} failed")
    if failed:
        print("FAILED:", failed)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
