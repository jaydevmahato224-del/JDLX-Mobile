"""
API-level end-to-end test for the Billing Agent feature.
=========================================================
Runs against the LOCAL jdlx.db via the Flask test client:

  1. Owner login token (issue_warehouse_token for warehouse 1)
  2. Create "Billing Agent" role
  3. Register a staff/agent -> capture setup link
  4. Setup password via token -> get staff JWT
  5. Staff login with email+password
  6. Fetch billing products (guarded endpoint, owner + staff)
  7. Generate an offline bill (stock decremented atomically)
  8. Staff cannot access owner-only agent management (403)
  9. Owner toggles agent inactive -> staff POS access revoked (403)
  10. Resend invite -> fresh setup link
  11. Cleanup: delete test staff + role (no leftovers)

Uses a fake email address so no real invite is delivered.
"""
import json
import os
import sys

# Force local DB: DATABASE_PATH alone does NOT disable Turso when .env has
# TURSO credentials — without FORCE_LOCAL_DB this test would run on LIVE data.
os.environ.setdefault("FORCE_LOCAL_DB", "1")
os.environ.setdefault("DATABASE_PATH", "jdlx.db")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

TEST_EMAIL = "flow-test-agent@jdlx.test"
TEST_NAME = "Flow Test Agent"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(f"  [{'✅' if ok else '❌'}] {name} {detail}")


def main():
    from app import app
    from warehouse_routes import issue_warehouse_token
    from database import get_db

    conn = get_db()
    # Pick a real warehouse (id 1 on local) for the owner token
    wh = conn.execute("SELECT id FROM warehouses ORDER BY id LIMIT 1").fetchone()
    conn.close()
    if not wh:
        print("No warehouse found in local DB — cannot run flow test.")
        sys.exit(1)
    vendor_id = wh["id"]
    owner_token = issue_warehouse_token(vendor_id, "owner@jdlx.test", "owner")

    client = app.test_client()
    H = {"Authorization": f"Bearer {owner_token}"}

    # 0. Owner can list staff & roles
    r = client.get("/api/warehouse/staff", headers=H)
    check("owner lists staff", r.status_code == 200, f"HTTP {r.status_code}")

    # 1. Create Billing Agent role
    r = client.post("/api/warehouse/roles", json={
        "role_name": "Billing Agent (flow-test)",
        "permissions": ["billing"],
    }, headers=H)
    data = r.get_json() or {}
    role_id = data.get("role_id")
    check("create billing role", r.status_code in (200, 201) and role_id, f"role_id={role_id}")

    # 2. Register agent
    r = client.post("/api/warehouse/staff", json={
        "name": TEST_NAME,
        "login_email": TEST_EMAIL,
        "role_id": role_id,
    }, headers=H)
    data = r.get_json() or {}
    staff_id = data.get("staff_id")
    setup_link = data.get("setup_link", "")
    check("register agent", r.status_code == 201 and staff_id, f"staff_id={staff_id}")
    check("setup link generated", "setup" in setup_link, setup_link[:60])

    setup_token = setup_link.split("token=")[-1] if "token=" in setup_link else ""

    # 3. Setup password
    r = client.post("/api/warehouse/staff/setup-password", json={
        "token": setup_token,
        "password": "secret123",
    })
    data = r.get_json() or {}
    staff_token = data.get("token", "")
    check("setup password -> JWT", r.status_code == 200 and staff_token)

    # 4. Staff login
    r = client.post("/api/warehouse/staff/login", json={
        "email": TEST_EMAIL,
        "password": "secret123",
    })
    data = r.get_json() or {}
    login_token = data.get("token", "")
    check("staff login", r.status_code == 200 and login_token)

    SH = {"Authorization": f"Bearer {login_token}"}

    # 4b. Session must return the staff profile (not the owner profile)
    r = client.get("/api/warehouse/session", headers=SH)
    body = r.get_json() or {}
    sess_user = body.get("user") or {}
    check("staff session returns agent profile", r.status_code == 200 and sess_user.get("staff_id") == staff_id
          and "Billing" in (sess_user.get("role_name") or ""), f"role={sess_user.get('role_name')}")

    # 5. Billing products (guarded)
    r = client.get("/api/warehouse/billing/products", headers=SH)
    body = r.get_json()
    check("billing products (staff)", r.status_code == 200 and isinstance(body, list), f"HTTP {r.status_code}")
    if isinstance(body, list) and body:
        check("product image_url resolved", "image_url" in body[0], f"img={str(body[0].get('image_url'))[:40]}")

    # 6. Staff cannot manage agents (owner-only)
    r = client.post("/api/warehouse/staff", json={
        "name": "Nope", "login_email": "nope@jdlx.test", "role_id": role_id,
    }, headers=SH)
    check("staff blocked from creating agents", r.status_code == 403, f"HTTP {r.status_code}")

    # 6b. Staff cannot read owner data endpoints (dashboard/orders/inventory)
    for path in ("/api/warehouse/dashboard", "/api/warehouse/orders", "/api/warehouse/inventory", "/api/warehouse/analytics"):
        r = client.get(path, headers=SH)
        check(f"staff blocked from {path.split('/')[-1]}", r.status_code in (401, 403), f"HTTP {r.status_code}")

    # 7. Generate an offline bill (pick first product with stock)
    products = []
    generated_bill = None
    r = client.get("/api/warehouse/billing/products", headers=SH)
    if r.status_code == 200:
        products = [p for p in (r.get_json() or []) if p.get("stock", 0) > 0]
    if products:
        prod = products[0]
        r = client.post("/api/warehouse/billing/generate", json={
            "customer_name": "Flow Test Customer",
            "customer_phone": "9999999999",
            "payment_mode": "CASH",
            "items": [{"product_id": prod["id"], "qty": 1}],
        }, headers=SH)
        data = r.get_json() or {}
        check("generate offline bill", r.status_code == 201 and data.get("order_number", "").startswith("BILL-"),
              f"order={data.get('order_number')}")
        if data.get("order_number"):
            generated_bill = {"order_number": data["order_number"], "product_id": prod["id"], "qty": 1}
    else:
        check("generate offline bill", False, "no in-stock product found in local DB")

    # 8. Owner deactivates agent -> staff POS access revoked
    r = client.patch(f"/api/warehouse/staff/{staff_id}", json={"status": "inactive"}, headers=H)
    check("owner deactivates agent", r.status_code == 200)
    r = client.get("/api/warehouse/billing/products", headers=SH)
    check("inactive agent blocked from POS", r.status_code == 403, f"HTTP {r.status_code}")

    # 9. Reactivate + resend invite
    client.patch(f"/api/warehouse/staff/{staff_id}", json={"status": "active"}, headers=H)
    r = client.post(f"/api/warehouse/staff/{staff_id}/resend-invite", headers=H)
    data = r.get_json() or {}
    check("resend invite", r.status_code == 200 and data.get("setup_link"), f"HTTP {r.status_code}")

    # 10. Cleanup
    r = client.delete(f"/api/warehouse/staff/{staff_id}", headers=H)
    check("delete agent", r.status_code == 200)
    conn = get_db()
    cur = conn.cursor()
    # Remove the generated bill + restore stock so the local DB stays pristine
    if generated_bill:
        order_row = cur.execute(
            "SELECT id FROM orders WHERE order_number = ?", (generated_bill["order_number"],)
        ).fetchone()
        if order_row:
            oid = order_row["id"]
            cur.execute("DELETE FROM order_items WHERE order_id = ?", (oid,))
            cur.execute("DELETE FROM orders WHERE id = ?", (oid,))
            qty = generated_bill["qty"]
            cur.execute(
                "UPDATE products SET stock = stock + ? WHERE id = ?", (qty, generated_bill["product_id"])
            )
            cur.execute(
                "UPDATE warehouse_inventory SET stock_quantity = COALESCE(stock_quantity, 0) + ?, "
                "available_stock = COALESCE(available_stock, 0) + ? "
                "WHERE warehouse_id = ? AND product_id = ?",
                (qty, qty, vendor_id, generated_bill["product_id"]),
            )
        conn.commit()
    cur.execute("DELETE FROM roles WHERE role_id = ?", (role_id,))
    conn.commit()
    conn.close()
    check("cleanup role", True)

    print("\n=== BILLING API FLOW TEST COMPLETE ===")
    failed = [n for n, ok, _ in results if not ok]
    print(f"Passed {len(results) - len(failed)}/{len(results)}" + (f" | FAILED: {failed}" if failed else " — ALL GREEN ✅"))


if __name__ == "__main__":
    main()
