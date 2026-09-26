"""
Catalog approval + report directive/escalation e2e
===================================================
In-memory DB, mocked auth:

  A. CATALOG APPROVAL
     1. Warehouse creates product -> approval_status 'pending', response flag
     2. Storefront list/detail/batch hidden; admin list shows it
     3. Admin approves -> storefront visible; variants approved with parent
     4. Reject path: note required, storefront stays hidden
     5. Re-approve after reject; double-approve blocked
     6. Warehouse notified + inventory list exposes approval fields
     7. Checkout product-meta rejects unapproved ids

  B. REPORT DIRECTIVE + ESCALATION
     8. Transfer with action_required + deadline + harassment warning
     9. Non-compliant warehouse action -> 409; compliant -> ok
    10. Escalation: status change, warning row, warehouse action blocked
    11. Escalated report closes via admin Resolve (override allowed)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_fd, _tmp_db = tempfile.mkstemp(suffix=".db")
os.close(_fd)
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = _tmp_db

import database
from database import get_db, init_db
init_db()

from flask import Flask
import admin_db
import warehouse_routes
import warehouse_returns
import report_routes
import app as jdlx_app

app = Flask(__name__)
app.register_blueprint(admin_db.admin_db_bp)
app.register_blueprint(warehouse_routes.warehouse_bp)
app.register_blueprint(warehouse_returns.warehouse_returns_bp)
app.register_blueprint(report_routes.report_bp)


@app.before_request
def _fake_auth():
    from flask import request
    p = request.path
    if p.startswith("/api/admin/"):
        request.user = {"user_id": 2, "role": "admin"}
    elif p.startswith("/api/warehouse/"):
        request.warehouse_payload = {"type": "warehouse", "warehouse_id": 1}
    elif p.startswith("/api/order-report"):
        request.user = {"user_id": 1, "role": "user"}


client = app.test_client()
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  [{detail}]" if detail and not cond else ""))


# --- notifications stubs ---
admin_db.notification_service = type("S", (), {
    "notify_user_internal": staticmethod(lambda *a, **k: True)})()
warehouse_returns.notification_service = admin_db.notification_service
report_routes.notification_service = admin_db.notification_service

# --- seed ---
conn = get_db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1,'g1','Cust','c@t.com','user')")
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (2,'g2','Admin','a@t.com','admin')")
conn.execute("INSERT INTO warehouses (id, warehouse_name, email, owner_name, pincode) VALUES (1,'WH-1','w@t.com','O','110001')")
conn.execute("INSERT INTO categories (id, name) VALUES (5,'Mobiles')")
conn.execute("INSERT INTO products (id, name, price, stock, approval_status) VALUES (1,'Seed PC',199,5,'approved')")
conn.execute("INSERT INTO orders (id, user_id, total_amount, order_status, order_number, customer_name, delivery_address, created_at) VALUES (701,1,199,'DELIVERED','ORD-A701','Cust','addr', datetime('now','-1 days'))")
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price, product_name) VALUES (701,1,1,199,'PC')")
conn.execute("INSERT INTO warehouse_order_assignments (order_id, warehouse_id, assignment_status) VALUES (701,1,'dispatched')")
conn.commit(); conn.close()


def one(sql, params=()):
    c = get_db()
    try:
        r = c.execute(sql, params).fetchone()
        return dict(r) if r else None
    finally:
        c.close()


WH = {"Authorization": "Bearer test-token"}
warehouse_routes.decode_warehouse_token = lambda t: {"type": "warehouse", "warehouse_id": 1}
warehouse_returns._get_current_warehouse_id = lambda: 1

print("\n== A1. Warehouse creates product -> pending ==")
resp = client.post("/api/warehouse/products", headers=WH, json={
    "name": "Test Charger 33W", "price": 499, "stock_quantity": 10,
    "category": "Mobiles", "category_id": 5, "description": "fast charger",
})
check("create 201", resp.status_code == 201, f"{resp.status_code} {resp.get_data(as_text=True)[:160]}")
body = resp.get_json()["data"] if resp.status_code == 201 else {}
check("response approval_status pending", body.get("approval_status") == "pending", str(body))
pid = body.get("product_id")
row = one("SELECT approval_status, approval_source, approval_warehouse_id FROM products WHERE id = ?", (pid,))
check("DB row pending/warehouse/1", row and row["approval_status"] == "pending" and row["approval_source"] == "warehouse" and row["approval_warehouse_id"] == 1, str(row))

# variant parent
resp = client.post("/api/warehouse/products", headers=WH, json={
    "name": "Test Earbuds", "price": 999, "stock_quantity": 5, "category": "Mobiles", "category_id": 5,
    "has_variants": True,
    "variants": [{"name": "Black", "price": 999, "stock_quantity": 5}],
})
vid = resp.get_json()["data"]["product_id"]
vrow = one("SELECT approval_status FROM products WHERE variant_group_id = ? AND id != ?", (vid, vid))
check("A1b variant also pending", resp.status_code == 201 and vrow and vrow["approval_status"] == "pending", str(vrow))

print("\n== A2. Storefront hidden while pending ==")
with jdlx_app.app.test_request_context():
    pass  # routes below run via test client on a bare app instead:
bare = jdlx_app.app
bare.config["TESTING"] = True
# app enforces force_https (301 http->https) — hit it with an https base_url
def _open(base, *a, **k):
    k.setdefault("base_url", "https://localhost")
    return __import__("werkzeug").test.Client.open(base, *a, **k)
bclient = bare.test_client()
bclient.open = _open.__get__(bclient)

# seed: make it discoverable-independent — check via direct queries the routes use
resp = bclient.get(f"/api/products/{pid}")
check("detail 404 while pending", resp.status_code == 404, str(resp.status_code))
resp = bclient.get("/api/products?include_count=1")
_rj = resp.get_json() or {}
_products = _rj.get("data") if isinstance(_rj, dict) else _rj
names = [p["id"] for p in (_products or [])] if resp.status_code == 200 else []
check("list excludes pending", pid not in names, f"{resp.status_code}")
resp = bclient.post("/api/products/batch", json={"ids": [pid]})
_bj = resp.get_json() or {}
_bj = _bj.get("data") if isinstance(_bj, dict) else _bj
batch_ids = [p["id"] for p in (_bj or [])] if resp.status_code == 200 else []
check("batch excludes pending", pid not in batch_ids, str(resp.status_code))

print("\n== A3. Admin approves -> storefront visible ==")
resp = client.post(f"/api/admin/products/{pid}/approve", json={"note": "Listing looks good"})
check("approve 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:140]}")
row = one("SELECT approval_status, approval_decided_by FROM products WHERE id = ?", (pid,))
check("approved by admin 2", row and row["approval_status"] == "approved" and row["approval_decided_by"] == 2, str(row))
resp = bclient.get(f"/api/products/{pid}")
check("detail 200 after approve", resp.status_code == 200, str(resp.status_code))
resp = bclient.get("/api/products?include_count=1")
_rj = resp.get_json() or {}
_products = _rj.get("data") if isinstance(_rj, dict) else _rj
names = [p["id"] for p in (_products or [])] if resp.status_code == 200 else []
check("list includes approved", pid in names, str(names[:5]))

print("\n== A4/A5. Reject path + re-approve + double-approve ==")
resp = client.post(f"/api/admin/products/{vid}/reject", json={})
check("reject without note 400", resp.status_code == 400, str(resp.status_code))
resp = client.post(f"/api/admin/products/{vid}/reject", json={"note": "Images missing"})
check("reject 200", resp.status_code == 200, str(resp.status_code))
vrow = one("SELECT approval_status FROM products WHERE id = ?", (vid,))
check("rejected hidden from detail", bclient.get(f"/api/products/{vid}").status_code == 404)
resp = client.post(f"/api/admin/products/{vid}/approve", json={})
check("re-approve after reject", resp.status_code == 200 and one("SELECT approval_status FROM products WHERE id = ?", (vid,))["approval_status"] == "approved", str(resp.status_code))
resp = client.post(f"/api/admin/products/{vid}/approve", json={})
check("double-approve 409", resp.status_code == 409, str(resp.status_code))

print("\n== A6. Warehouse notified + inventory exposes approval ==")
wn = one("SELECT title FROM warehouse_notifications WHERE warehouse_id = 1 ORDER BY id DESC LIMIT 1")
check("warehouse approval notification", wn and "approved" in wn["title"].lower(), str(wn))
resp = client.get("/api/warehouse/inventory", headers=WH)
items = resp.get_json() if resp.status_code == 200 else []  # /inventory returns a bare list
mine = next((i for i in items if i.get("product_id") == pid), None)
check("inventory carries approval_status", mine and mine.get("approval_status") == "approved", str(mine and mine.get("approval_status")))

print("\n== A7. Checkout meta rejects unapproved ==")
conn = get_db()
conn.execute("INSERT INTO products (id, name, price, stock, approval_status, approval_source) VALUES (909, 'Pending Item', 50, 3, 'pending', 'warehouse')")
conn.commit(); conn.close()
resp = bclient.post("/api/orders/product-meta", json={"product_ids": [909]})
meta_ids = list((resp.get_json() or {}).keys()) if resp.status_code == 200 else ["__err__"]
check("checkout meta excludes pending", 909 not in meta_ids, f"{resp.status_code} {str(resp.get_data(as_text=True))[:100]}")

print("\n== B8. Transfer with directive + warning ==")
resp = client.post("/api/order-report", data={
    "order_id": "701", "report_type": "Item not delivered",
    "description": "Package never arrived, delivery photo is not my address at all",
})
check("report created", resp.status_code == 201, str(resp.status_code))
rid = resp.get_json()["data"]["report_id"]
resp = client.post(f"/api/admin/order-reports/{rid}/transfer", json={
    "note": "POD image mismatch verified — genuine complaint",
    "action_required": "refund", "directive_deadline_hours": 48,
    "harassment_warning": True,
})
check("transfer 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:140]}")
r = one("SELECT action_required, directive_deadline, warehouse_id FROM order_reports WHERE id = ?", (rid,))
check("directive + deadline saved", r and r["action_required"] == "refund" and r["directive_deadline"] is not None, str(r))
warn = one("SELECT reason FROM warehouse_warnings WHERE report_id = ?", (rid,))
check("harassment warning recorded", warn is not None, str(warn))
resp = client.post(f"/api/admin/order-reports/{rid}/transfer", json={"action_required": "bogus"})
check("invalid directive 400", resp.status_code == 400, str(resp.status_code))

print("\n== B9. Directive enforcement ==")
resp = client.post(f"/api/warehouse/order-reports/{rid}/action",
                   headers=WH, json={"action": "No issue found after investigation", "notes": "checked"})
check("non-compliant action 409", resp.status_code == 409, f"{resp.status_code} {resp.get_data(as_text=True)[:120]}")
resp = client.post(f"/api/warehouse/order-reports/{rid}/action",
                   headers=WH, json={"action": "Refund processed to customer wallet", "notes": "UPI refund done"})
check("compliant action 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:120]}")
r = one("SELECT status, action_taken FROM order_reports WHERE id = ?", (rid,))
check("status Action Taken", r["status"] == "Action Taken" and "refund" in r["action_taken"].lower(), str(r))

print("\n== B10. Escalation ==")
resp = client.post(f"/api/admin/order-reports/{rid}/escalate", json={})
check("escalate without note 400", resp.status_code == 400, str(resp.status_code))
resp = client.post(f"/api/admin/order-reports/{rid}/escalate", json={"note": "Refund never actually credited — suspended payout review"})
check("escalate 200", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:140]}")
r = one("SELECT status, escalated_from_warehouse_id FROM order_reports WHERE id = ?", (rid,))
check("status Escalated + source warehouse", r["status"] == "Escalated to Admin" and r["escalated_from_warehouse_id"] == 1, str(r))
check("second warning row", one("SELECT COUNT(*) c FROM warehouse_warnings WHERE report_id = ?", (rid,))["c"] == 2)
resp = client.post(f"/api/warehouse/order-reports/{rid}/action", headers=WH, json={"action": "anything"})
check("warehouse action blocked after escalation", resp.status_code == 409, str(resp.status_code))

print("\n== B11. Escalated report closes via admin ==")
resp = client.patch(f"/api/admin/order-reports/{rid}", json={"status": "Resolved", "resolution": "Admin refunded directly"})
check("resolve override on escalated", resp.status_code == 200, f"{resp.status_code} {resp.get_data(as_text=True)[:120]}")
check("final Resolved", one("SELECT status FROM order_reports WHERE id = ?", (rid,))["status"] == "Resolved")

print(f"\n{'='*60}\nRESULTS: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL); sys.exit(1)
print("ALL APPROVAL + DIRECTIVE CHECKS PASSED")
