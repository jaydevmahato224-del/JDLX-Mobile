"""
Offline (POS) pricing test.
===========================
Verifies that:
  1. A product WITH offline_price is listed in billing/products at that price
     (offline_price + regular_price fields exposed).
  2. Bill generation uses the offline price for subtotal/total.
  3. A product WITHOUT offline_price still falls back to the regular online
     price (no business logic removed).
  4. Stock/quantity handling is untouched.

Runs against the LOCAL jdlx.db (self-forces FORCE_LOCAL_DB=1) and cleans up
everything it creates (orders, inventory rows, products, restored stock).
"""
import json
import os
import sys

os.environ.setdefault("FORCE_LOCAL_DB", "1")
os.environ.setdefault("DATABASE_PATH", "jdlx.db")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(f"  [{'✅' if ok else '❌'}] {name} {detail}")


def main():
    from app import app
    from warehouse_routes import issue_warehouse_token
    from database import get_db

    conn = get_db()
    wh = conn.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()
    if not wh:
        print("No warehouse found — cannot run.")
        sys.exit(1)
    vendor_id = wh["id"]
    conn.close()

    owner_token = issue_warehouse_token(vendor_id, "owner@jdlx.test", "owner")
    client = app.test_client()
    H = {"Authorization": f"Bearer {owner_token}"}
    suffix = str(int(os.getpid()))[:6]
    created_product_ids = []

    # --- Helper: create a product via the real warehouse route ---
    def create_product(name, price, offline_price=None, stock=25):
        r = client.post("/api/warehouse/products", headers=H, json={
            "name": name,
            "price": price,
            "offline_price": offline_price,
            "stock_quantity": stock,
            "category": "POS Test",
            "delivery_time": "10-30 mins",
        })
        body = r.get_json() or {}
        pid = (body.get("data") or {}).get("product_id") if isinstance(body, dict) else None
        created_product_ids.append(pid)
        return r.status_code, pid

    try:
        # 1. Product WITHOUT offline price (fallback must stay intact)
        code, pid_plain = create_product(f"POS Plain {suffix}", 100.0, offline_price=None)
        check("create product without offline price", code in (200, 201) and pid_plain, f"HTTP {code}")

        # 2. Product WITH offline price
        code, pid_off = create_product(f"POS Offline {suffix}", 250.0, offline_price=199.0)
        check("create product with offline price", code in (200, 201) and pid_off, f"HTTP {code}")

        # 3. billing/products: fallback product priced at regular price
        r = client.get("/api/warehouse/billing/products", headers=H)
        body = r.get_json() or []
        plain_item = next((p for p in body if p["id"] == pid_plain), None)
        off_item = next((p for p in body if p["id"] == pid_off), None)
        check("fallback product uses regular price",
              plain_item and float(plain_item["price"]) == 100.0 and plain_item["offline_price"] is None,
              f"price={plain_item and plain_item['price']}")
        check("offline product priced at offline price",
              off_item and float(off_item["price"]) == 199.0 and float(off_item["regular_price"]) == 250.0,
              f"price={off_item and off_item['price']} regular={off_item and off_item['regular_price']}")

        # 4. Generate a bill for the offline-priced product (qty 2)
        r = client.post("/api/warehouse/billing/generate", headers=H, json={
            "customer_name": "Offline Price Test",
            "payment_mode": "CASH",
            "items": [{"product_id": pid_off, "quantity": 2}],
        })
        bill = r.get_json() or {}
        check("bill generated", r.status_code in (200, 201) and bill.get("order_number"), f"HTTP {r.status_code}")
        expected_subtotal = round(199.0 * 2, 2)
        expected_total = round(expected_subtotal + round(expected_subtotal * 0.18, 2), 2)
        check("bill subtotal uses offline price",
              abs(float(bill.get("subtotal", -1)) - expected_subtotal) < 0.01,
              f"subtotal={bill.get('subtotal')} expected={expected_subtotal}")
        check("bill total includes 18% GST on offline price",
              abs(float(bill.get("total_amount", -1)) - expected_total) < 0.01,
              f"total={bill.get('total_amount')} expected={expected_total}")

        # 5. Stock is untouched by pricing (quantity logic unchanged)
        conn = get_db()
        wi = conn.execute("SELECT stock_quantity, available_stock FROM warehouse_inventory WHERE warehouse_id=? AND product_id=?", (vendor_id, pid_off)).fetchone()
        check("stock decremented by qty only", wi and int(wi["stock_quantity"]) == 23, f"stock={wi and wi['stock_quantity']}")
        conn.close()

        # 6. Order row persisted with offline price in order_items
        conn = get_db()
        oi = conn.execute(
            "SELECT oi.price FROM order_items oi JOIN orders o ON o.id = oi.order_id "
            "WHERE o.customer_name = 'Offline Price Test' ORDER BY oi.id DESC LIMIT 1"
        ).fetchone()
        check("order_items stores offline price", oi and abs(float(oi["price"]) - 199.0) < 0.01, f"price={oi and oi['price']}")
        conn.close()

        # 7. Register-existing path: POST /warehouse/inventory persists offline_price
        # (simulate "not yet in this warehouse" by removing the auto-created row)
        conn = get_db()
        conn.execute("DELETE FROM warehouse_inventory WHERE product_id = ?", (pid_plain,))
        conn.execute("UPDATE products SET stock = 0 WHERE id = ?", (pid_plain,))
        conn.commit()
        conn.close()
        r = client.post("/api/warehouse/inventory", headers=H, json={
            "product_id": pid_plain,
            "sku": f"SKU-PLAIN-{suffix}",
            "stock_quantity": 5,
            "offline_price": 88.5,
        })
        conn = get_db()
        stored = conn.execute("SELECT offline_price FROM products WHERE id = ?", (pid_plain,)).fetchone()
        conn.close()
        check("register existing product persists offline price",
              r.status_code in (200, 201) and stored and abs(float(stored["offline_price"]) - 88.5) < 0.01,
              f"HTTP {r.status_code} stored={stored and stored['offline_price']}")

        # 8. Negative/whitespace offline price treated as not set (fallback intact)
        code, pid_neg = create_product(f"POS Neg {suffix}", 50.0, offline_price=-25)
        r = client.get("/api/warehouse/billing/products", headers=H)
        neg_item = next((p for p in (r.get_json() or []) if p["id"] == pid_neg), None)
        check("negative offline price ignored (fallback)",
              neg_item and float(neg_item["price"]) == 50.0 and neg_item["offline_price"] is None,
              f"price={neg_item and neg_item['price']}")

        # 9. Leak guard: online store normalizer must strip offline_price
        from app import normalize_product_row
        conn = get_db()
        raw = conn.execute(
            "SELECT id, name, price, offline_price, stock, images, category, status FROM products WHERE id = ?",
            (pid_off,),
        ).fetchone()
        conn.close()
        normalized = normalize_product_row(raw)
        check("online normalizer strips offline_price (no store leak)",
              normalized and "offline_price" not in normalized and float(normalized["price"]) == 250.0,
              f"has_offline={normalized and 'offline_price' in normalized}")

    finally:
        # --- Cleanup: delete test orders, restore stock, delete products/inventory ---
        conn = get_db()
        cur = conn.cursor()
        orders = cur.execute(
            "SELECT id FROM orders WHERE customer_name = 'Offline Price Test'"
        ).fetchall()
        for o in orders:
            items = cur.execute("SELECT product_id, quantity FROM order_items WHERE order_id = ?", (o["id"],)).fetchall()
            for it in items:
                cur.execute("UPDATE products SET stock = stock + ? WHERE id = ?", (it["quantity"], it["product_id"]))
                cur.execute(
                    "UPDATE warehouse_inventory SET stock_quantity = COALESCE(stock_quantity, 0) + ?, "
                    "available_stock = COALESCE(available_stock, 0) + ? WHERE warehouse_id = ? AND product_id = ?",
                    (it["quantity"], it["quantity"], vendor_id, it["product_id"]),
                )
            cur.execute("DELETE FROM order_items WHERE order_id = ?", (o["id"],))
            cur.execute("DELETE FROM orders WHERE id = ?", (o["id"],))
        for pid in created_product_ids:
            if pid:
                cur.execute("DELETE FROM warehouse_inventory WHERE product_id = ?", (pid,))
                cur.execute("DELETE FROM products WHERE id = ?", (pid,))
        conn.commit()
        conn.close()
        check("cleanup done", True)

    passed = sum(1 for _, ok in results if ok)
    print(f"\n=== OFFLINE PRICE TEST: {passed}/{len(results)} PASSED ===")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
