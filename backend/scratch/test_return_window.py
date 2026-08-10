"""
API-level test for the 24h return/exchange/cancel window on OFFLINE counter bills.
===================================================================================
Runs against the LOCAL jdlx.db via the Flask test client (FORCE_LOCAL_DB=1):

  1. Generate a fresh offline bill -> return within the window succeeds
  2. Backdate the bill 26h -> return / exchange / cancel all rejected (400)
  3. Restore created_at -> cancel succeeds (restocks, leaves no leftovers)
"""
import os
import sys

os.environ.setdefault("FORCE_LOCAL_DB", "1")
os.environ.setdefault("DATABASE_PATH", "jdlx.db")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'OK' if ok else 'FAIL'}] {name} {detail}")


def main():
    from app import app
    from warehouse_routes import issue_warehouse_token
    from database import get_db

    conn = get_db()
    wh = conn.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()
    conn.close()
    if not wh:
        print("No warehouse found in local DB")
        sys.exit(1)
    vendor_id = wh["id"]

    client = app.test_client()
    H = {"Authorization": f"Bearer {issue_warehouse_token(vendor_id, 'owner@jdlx.test', 'owner')}"}

    # 1. Pick an in-stock product and generate a fresh bill
    products = client.get("/api/warehouse/billing/products", headers=H).get_json()
    if not products:
        print("No products available for billing — cannot run window test")
        sys.exit(1)
    prod = products[0]

    # qty 2 so a partial in-window return leaves the bill still actionable
    r = client.post("/api/warehouse/billing/generate", headers=H, json={
        "customer_name": "Window Test Customer",
        "payment_mode": "CASH",
        "items": [{"product_id": prod["id"], "qty": 2, "price": prod["price"]}],
    })
    data = r.get_json()
    check("generate offline bill", r.status_code == 201, f"order_id={data.get('order_id')}")
    order_id = data["order_id"]

    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")
        # 2. In-window return succeeds
        item = conn.execute(
            "SELECT id, quantity FROM order_items WHERE order_id = ? LIMIT 1", (order_id,)
        ).fetchone()
        conn.commit()
    finally:
        pass
    conn.close()
    item_id = item["id"]

    # In-window: partial return should work (bill created seconds ago)
    r = client.post("/api/warehouse/billing/return", headers=H, json={
        "order_id": order_id,
        "items": [{"item_id": item_id, "qty": 1}],
    })
    check("return within 24h window succeeds", r.status_code == 200,
          f"status={r.status_code}")

    # 3. Backdate the bill 26h -> everything must be rejected
    conn = get_db()
    conn.execute(
        "UPDATE orders SET created_at = datetime('now', '-26 hours') WHERE id = ?",
        (order_id,),
    )
    conn.commit()
    conn.close()

    r = client.post("/api/warehouse/billing/return", headers=H, json={
        "order_id": order_id,
        "items": [{"item_id": item_id, "qty": 1}],
    })
    body = r.get_json() or {}
    check("return after 24h rejected", r.status_code == 400 and "24 hours" in str(body),
          f"status={r.status_code} msg={str(body.get('message'))[:60]}")

    r = client.post("/api/warehouse/billing/exchange", headers=H, json={
        "order_id": order_id,
        "return_items": [{"item_id": item_id, "qty": 1}],
        "new_items": [{"product_id": prod["id"], "qty": 1}],
        "payment_mode": "CASH",
    })
    body = r.get_json() or {}
    check("exchange after 24h rejected", r.status_code == 400 and "24 hours" in str(body),
          f"status={r.status_code} msg={str(body.get('message'))[:60]}")

    r = client.post("/api/warehouse/billing/cancel", headers=H, json={"order_id": order_id})
    body = r.get_json() or {}
    check("cancel after 24h rejected", r.status_code == 400 and "24 hours" in str(body),
          f"status={r.status_code} msg={str(body.get('message'))[:60]}")

    # 4. Restore timestamp -> cancel succeeds (restocks everything, cleans up)
    conn = get_db()
    conn.execute(
        "UPDATE orders SET created_at = datetime('now') WHERE id = ?",
        (order_id,),
    )
    conn.commit()
    conn.close()

    r = client.post("/api/warehouse/billing/cancel", headers=H, json={"order_id": order_id})
    body = r.get_json() or {}
    check("cancel after restoring timestamp succeeds", r.status_code == 200,
          f"status={r.status_code} refund={body.get('refund_amount')}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n=== RETURN WINDOW TEST COMPLETE === Passed {passed}/{len(results)}")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
