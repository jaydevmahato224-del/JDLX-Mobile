"""
Business-logic smoke test — verifies the security fixes did NOT remove/break any
core commerce behavior:

  A. Checkout PREPAID with offer (coupon) + wallet -> server-side pricing,
     wallet debit, offer usage recording
  B. Payment success (confirm_order_and_decrement_stock_logic) -> global +
     warehouse stock decrement + warehouse assignment
  C. Checkout COD -> advance/remaining split
  D. Admin status transitions (whitelist intact: PACKED/SHIPPED/DELIVERED) +
     CANCELLED restores stock (global + warehouse)
  E. Refund PROCESSED -> wallet credit + order REFUNDED
  F. User orders + wallet endpoints (ownership intact)

Runs against a TEMP local SQLite DB — never touches production/Turso data.
"""
import os
import sys
import tempfile
import datetime
import sqlite3

_tmpdir = tempfile.mkdtemp(prefix="jdlx_biz_test_")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["DISABLE_RATE_LIMIT"] = "1"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import jwt

import app as app_module
from database import init_db

init_db()

app = app_module.app
app.config["TESTING"] = True
client = app.test_client()

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ PASS: {name}")
    else:
        FAIL.append(name)
        print(f"  ❌ FAIL: {name} {detail}")


def db():
    return sqlite3.connect(os.environ["DATABASE_PATH"])


# Fresh temp DBs lack columns that production gets via migrations — mirror them
# so the checkout/confirm/status flows work identically to production.
_conn0 = db()
try:
    _conn0.execute("ALTER TABLE products ADD COLUMN category TEXT")
except Exception:
    pass
for _col in ['confirmed_at', 'packed_at', 'shipped_at', 'delivered_at', 'cancelled_at',
             'out_for_delivery_at', 'status_packing_at', 'status_out_at', 'status_delivered_at']:
    try:
        _conn0.execute(f"ALTER TABLE orders ADD COLUMN {_col} TIMESTAMP")
    except Exception:
        pass
_conn0.commit()
_conn0.close()


def token(user_id, role="user"):
    now = datetime.datetime.utcnow()
    return jwt.encode(
        {"user_id": user_id, "email": f"u{user_id}@t.local", "role": role,
         "iat": now, "exp": now + datetime.timedelta(hours=1)},
        app_module.SECRET_KEY, algorithm="HS256",
    )


# ---------- Setup ----------
conn = db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'Customer', 'c@t.local', 'user')")
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (2, 'g2', 'Admin', 'a@t.local', 'super_admin')")
conn.execute("INSERT INTO products (id, name, price, stock, sub_category) VALUES (301, 'Back Cover', 100, 10, 'cover')")
conn.execute("INSERT INTO products (id, name, price, stock, sub_category) VALUES (302, 'Tempered Glass', 200, 5, 'glass')")
conn.execute("INSERT INTO warehouses (id, warehouse_name, email) VALUES (701, 'WH-B', 'wh@t.local')")
conn.execute("INSERT INTO warehouse_inventory (warehouse_id, warehouse_partner_id, product_id, product_name, stock_quantity, available_stock) VALUES (701, 701, 301, 'Back Cover', 10, 10)")
conn.execute("INSERT INTO warehouse_inventory (warehouse_id, warehouse_partner_id, product_id, product_name, stock_quantity, available_stock) VALUES (701, 701, 302, 'Tempered Glass', 5, 5)")
conn.execute("INSERT INTO wallet (user_id, balance) VALUES (1, 50)")
# Coupon: 10% off, per-user limit 2
conn.execute("""INSERT INTO offers (id, title, offer_type, discount_type, discount_value, min_order_amount, max_discount_amount,
                target_type, applicable_on, coupon_code, usage_limit, per_user_limit, is_active)
                VALUES (1, 'Test 10%', 'coupon', 'percentage', 10, 0, NULL, 'all', 'all', 'TEST10', 100, 2, 1)""")
conn.commit()
conn.close()

HDRS = {"Authorization": f"Bearer {token(1)}", "Content-Type": "application/json"}
ADMIN = {"Authorization": f"Bearer {token(2, 'super_admin')}", "Content-Type": "application/json"}

# ---------- A. Checkout PREPAID + offer + wallet ----------
print("\n=== A. Checkout PREPAID with offer + wallet ===")
r = client.post("/api/checkout", json={
    "items": [{"id": 301, "qty": 2}, {"id": 302, "qty": 1}],
    "address": "Test Street, Delhi", "phone": "9999999999", "customer_name": "Test Customer",
    "payment_type": "PREPAID", "offer_id": 1, "wallet_amount": 50, "pincode": "110001",
}, headers=HDRS)
check("checkout -> 201", r.status_code == 201, f"(got {r.status_code} {r.get_json()})")
body = r.get_json() or {}
summ = body.get("summary", {})
check("server-side subtotal = 400 (2x100 + 1x200)", summ.get("subtotal") == 400, f"(got {summ.get('subtotal')})")
check("discount = 40 (10% of 400)", summ.get("discount") == 40, f"(got {summ.get('discount')})")
check("wallet applied = 50", summ.get("wallet_amount") == 50, f"(got {summ.get('wallet_amount')})")
check("delivery fee = 49 (below free-delivery threshold)", summ.get("delivery_charge") == 49, f"(got {summ.get('delivery_charge')})")
order_id = body.get("order_id")
conn = db()
row = conn.execute("SELECT total_amount, order_status, payment_type FROM orders WHERE id = ?", (order_id,)).fetchone()
wallet_bal = conn.execute("SELECT balance FROM wallet WHERE user_id = 1").fetchone()[0]
txn = conn.execute("SELECT amount, type FROM wallet_transactions WHERE user_id = 1 AND reference_id = ?", (str(order_id),)).fetchone()
usage = conn.execute("SELECT discount_applied FROM offer_usage WHERE order_id = ?", (order_id,)).fetchone()
offer_count = conn.execute("SELECT usage_count FROM offers WHERE id = 1").fetchone()[0]
conn.close()
# 360 + 7 platform + 49 delivery - 50 wallet = 366
check("order total = 366 (server-computed, client total ignored)", row[0] == 366, f"(got {row[0]})")
check("order PLACED (payment pending)", row[1] == "PLACED", f"(got {row[1]})")
check("wallet debited 50 (atomic)", wallet_bal == 0 and txn and txn[0] == 50 and txn[1] == "debit", f"(bal={wallet_bal}, txn={txn})")
check("offer usage recorded (40)", usage is not None and usage[0] == 40, f"(got {usage})")
check("offer usage_count incremented to 1", offer_count == 1, f"(got {offer_count})")

# ---------- B. Payment success -> confirm + stock ----------
print("\n=== B. Confirm + stock decrement (payment success) ===")
from app import confirm_order_and_decrement_stock_logic
conn = db()
conn.row_factory = sqlite3.Row
cur = conn.cursor()
was = confirm_order_and_decrement_stock_logic(cur, order_id)
conn.commit()
p301 = conn.execute("SELECT stock FROM products WHERE id = 301").fetchone()[0]
p302 = conn.execute("SELECT stock FROM products WHERE id = 302").fetchone()[0]
w301 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 301").fetchone()[0]
w302 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 302").fetchone()[0]
o_st = conn.execute("SELECT order_status FROM orders WHERE id = ?", (order_id,)).fetchone()[0]
assign = conn.execute("SELECT warehouse_id FROM warehouse_order_assignments WHERE order_id = ?", (order_id,)).fetchone()
conn.close()
check("confirm returned True", was is True, f"(got {was})")
check("order CONFIRMED", o_st == "CONFIRMED", f"(got {o_st})")
check("products.stock decremented (10->8, 5->4)", p301 == 8 and p302 == 4, f"(got {p301},{p302})")
check("warehouse_inventory decremented (10->8, 5->4)", w301 == 8 and w302 == 4, f"(got {w301},{w302})")
check("warehouse assignment created", assign is not None and assign[0] == 701, f"(got {assign})")

# ---------- C. Checkout COD ----------
print("\n=== C. Checkout COD (advance split) ===")
r = client.post("/api/checkout", json={
    "items": [{"id": 301, "qty": 1}],
    "address": "Test Street", "phone": "9999999999", "customer_name": "COD Customer",
    "payment_type": "COD", "pincode": "110001",
}, headers=HDRS)
check("COD checkout -> 201", r.status_code == 201, f"(got {r.status_code} {r.get_json()})")
cod_id = (r.get_json() or {}).get("order_id")
conn = db()
cod = conn.execute("SELECT total_amount, cod_advance_paid, cod_remaining_amount, payment_type FROM orders WHERE id = ?", (cod_id,)).fetchone()
conn.close()
# 100 + 7 + 99(cod fee) = 206; advance 49; remaining 157
check("COD total = 206 (100 + 7 + 99 cod fee)", cod[0] == 206, f"(got {cod[0]})")
check("COD advance paid = 49", cod[1] == 49, f"(got {cod[1]})")
check("COD remaining = 157", cod[2] == 157, f"(got {cod[2]})")

# ---------- D. Admin status transitions + cancel restore ----------
print("\n=== D. Admin status flow (whitelist) + cancel restores stock ===")
r = client.patch(f"/api/admin/order/{cod_id}/status", json={"status": "PACKED"}, headers=ADMIN)
check("COD PLACED->PACKED -> 200", r.status_code == 200, f"(got {r.status_code})")
r = client.patch(f"/api/admin/order/{cod_id}/status", json={"status": "SHIPPED"}, headers=ADMIN)
check("PACKED->SHIPPED -> 200", r.status_code == 200, f"(got {r.status_code})")
r = client.patch(f"/api/admin/order/{cod_id}/status", json={"status": "DELIVERED"}, headers=ADMIN)
check("SHIPPED->DELIVERED -> 200", r.status_code == 200, f"(got {r.status_code})")

# Cancel the CONFIRMED prepaid order -> stock must be restored (global + warehouse)
r = client.patch(f"/api/admin/order/{order_id}/status", json={"status": "CANCELLED"}, headers=ADMIN)
check("CONFIRMED->CANCELLED -> 200", r.status_code == 200, f"(got {r.status_code})")
conn = db()
p301 = conn.execute("SELECT stock FROM products WHERE id = 301").fetchone()[0]
p302 = conn.execute("SELECT stock FROM products WHERE id = 302").fetchone()[0]
w301 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 301").fetchone()[0]
w302 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 302").fetchone()[0]
conn.close()
check("cancel restored products.stock (8->10, 4->5)", p301 == 10 and p302 == 5, f"(got {p301},{p302})")
check("cancel restored warehouse_inventory (8->10, 4->5)", w301 == 10 and w302 == 5, f"(got {w301},{w302})")

# ---------- E. Refund PROCESSED -> wallet credit ----------
print("\n=== E. Refund PROCESSED -> wallet credit ===")
# place a fresh PREPAID order, confirm it, then refund it
r = client.post("/api/checkout", json={
    "items": [{"id": 301, "qty": 1}],
    "address": "Test Street", "phone": "9999999999", "customer_name": "Refund Customer",
    "payment_type": "PREPAID", "pincode": "110001",
}, headers=HDRS)
refund_order = (r.get_json() or {}).get("order_id")
conn = db()
conn.row_factory = sqlite3.Row
cur = conn.cursor()
confirm_order_and_decrement_stock_logic(cur, refund_order)
conn.commit()
conn.close()
conn = db()
conn.execute("INSERT INTO refund_requests (order_id, user_id, amount, reason, status) VALUES (?, 1, 156, 'not needed', 'Pending')", (refund_order,))
conn.commit()
refund_id = conn.execute("SELECT id FROM refund_requests WHERE order_id = ?", (refund_order,)).fetchone()[0]
conn.close()
r = client.patch(f"/api/admin/refund/{refund_id}", json={"status": "PROCESSED"}, headers=ADMIN)
check("refund PROCESSED -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
bal = conn.execute("SELECT balance FROM wallet WHERE user_id = 1").fetchone()[0]
o_st = conn.execute("SELECT order_status FROM orders WHERE id = ?", (refund_order,)).fetchone()[0]
rrow = conn.execute("SELECT status FROM refund_requests WHERE id = ?", (refund_id,)).fetchone()[0]
txn2 = conn.execute("SELECT type, amount FROM wallet_transactions WHERE user_id = 1 AND reason LIKE '%Refund%' ORDER BY id DESC LIMIT 1").fetchone()
conn.close()
check("wallet credited with refund (0 -> 156)", bal == 156, f"(got {bal})")
check("order marked REFUNDED", o_st == "REFUNDED", f"(got {o_st})")
check("refund request status PROCESSED", rrow == "PROCESSED", f"(got {rrow})")
check("refund credit transaction recorded", txn2 is not None and txn2[0] == "credit" and txn2[1] == 156, f"(got {txn2})")

# ---------- F. User orders + wallet endpoints ----------
print("\n=== F. User orders + wallet endpoints (ownership) ===")
r = client.get("/api/user/orders", headers=HDRS)
orders = r.get_json() or []
check("user orders endpoint 200 + only own orders", r.status_code == 200 and all(o.get("user_id") in (None, 1) for o in orders), f"(got {r.status_code}, n={len(orders) if isinstance(orders, list) else '?'})")
r = client.get("/api/user/wallet", headers=HDRS)
wbody = r.get_json() or {}
check("wallet endpoint returns balance 156", wbody.get("balance") == 156, f"(got {wbody.get('balance')})")

# Wallet guards (design: wallet_amount is clamped to the ORDER TOTAL first,
# then the balance check runs — so requesting 500 with balance==total==156 is a
# legitimate full-wallet payment; overdraw only happens when balance < total).
r = client.post("/api/checkout", json={
    "items": [{"id": 301, "qty": 1}],
    "address": "Test Street", "phone": "9999999999", "customer_name": "Wallet Test",
    "payment_type": "PREPAID", "wallet_amount": 500, "pincode": "110001",
}, headers=HDRS)
body = r.get_json() or {}
check("wallet clamped to order total (request 500 -> 156), full-wallet payment ok", r.status_code == 201 and (body.get("summary") or {}).get("wallet_amount") == 156, f"(got {r.status_code} {body})")
conn = db()
bal = conn.execute("SELECT balance FROM wallet WHERE user_id = 1").fetchone()[0]
conn.close()
check("wallet debited exactly the clamped amount (156 -> 0)", bal == 0, f"(got {bal})")

# Now balance is 0 < order total 156: overdraw attempt must be rejected (no free money)
r = client.post("/api/checkout", json={
    "items": [{"id": 301, "qty": 1}],
    "address": "Test Street", "phone": "9999999999", "customer_name": "Wallet Test 2",
    "payment_type": "PREPAID", "wallet_amount": 500, "pincode": "110001",
}, headers=HDRS)
check("wallet overdraw (balance 0 < total) -> 400 (no free money)", r.status_code == 400, f"(got {r.status_code} {r.get_json()})")
conn = db()
bal = conn.execute("SELECT balance FROM wallet WHERE user_id = 1").fetchone()[0]
conn.close()
check("wallet balance unchanged after rejected overdraw (0)", bal == 0, f"(got {bal})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL BUSINESS-LOGIC TESTS PASSED ✅")
