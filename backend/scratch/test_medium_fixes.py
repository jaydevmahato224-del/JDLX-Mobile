"""
Verification for the two MEDIUM fixes:
  1. Admin order-status whitelist + terminal-state guard (app.py)
  2. warehouse_inventory restore on cancel/refund/reject (handle_stock_on_status_change)

Runs against a TEMP local SQLite DB (never touches production/Turso data).
"""
import os
import sys
import tempfile
import time as _time
import datetime

# --- Force a temp local DB BEFORE importing app ---
_tmpdir = tempfile.mkdtemp(prefix="jdlx_med_test_")
os.environ["FORCE_LOCAL_DB"] = "1"
os.environ["DATABASE_PATH"] = os.path.join(_tmpdir, "test.db")
os.environ["DISABLE_RATE_LIMIT"] = "1"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")

import sqlite3

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


def admin_token():
    now = datetime.datetime.utcnow()
    payload = {
        "user_id": 1,
        "email": "admin@test.local",
        "role": "super_admin",
        "iat": now,
        "exp": now + datetime.timedelta(hours=1),
    }
    return jwt.encode(payload, app_module.SECRET_KEY, algorithm="HS256")


TOKEN = admin_token()
HDRS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

# --- Setup ---
conn = db()
conn.execute("INSERT INTO users (id, google_id, name, email, role) VALUES (1, 'g1', 'Admin', 'admin@test.local', 'super_admin')")
conn.execute("INSERT INTO products (id, name, price, stock) VALUES (101, 'Test Product', 100, 50)")
conn.execute("INSERT INTO warehouses (id, warehouse_name, email) VALUES (501, 'WH-A', 'wh@test.local')")
# warehouse_inventory: both warehouse_id and warehouse_partner_id kept in sync
conn.execute(
    "INSERT INTO warehouse_inventory (warehouse_id, warehouse_partner_id, product_id, product_name, stock_quantity, available_stock) VALUES (501, 501, 101, 'Test Product', 10, 10)"
)
conn.commit()
conn.close()

print("\n=== 1. Admin order status whitelist ===")

# 1a. Arbitrary status rejected
r = client.patch("/api/admin/order/999/status", json={"status": "HACKED"}, headers=HDRS)
check("arbitrary status 'HACKED' -> 400", r.status_code == 400, f"(got {r.status_code} {r.get_json()})")

# 1b. Empty/missing status rejected
r = client.patch("/api/admin/order/999/status", json={"status": ""}, headers=HDRS)
check("empty status -> 400", r.status_code == 400, f"(got {r.status_code})")

# 1c. Valid status accepted (create a CONFIRMED order first)
conn = db()
conn.execute(
    "INSERT INTO orders (id, user_id, total_amount, order_status, dark_store_id, source) VALUES (1001, 1, 200, 'CONFIRMED', 501, 'ONLINE')"
)
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1001, 101, 2, 100)")
conn.commit()
conn.close()

r = client.patch("/api/admin/order/1001/status", json={"status": "PACKED"}, headers=HDRS)
check("valid status PACKED -> 200 + packed_at set", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
row = conn.execute("SELECT order_status, packed_at FROM orders WHERE id = 1001").fetchone()
conn.close()
check("order_status=PACKED in DB", row[0] == "PACKED", f"(got {row})")
check("packed_at timestamp set", row[1] is not None, f"(got {row[1]})")

# 1d. Terminal-state guard: DELIVERED is final
r = client.patch("/api/admin/order/1001/status", json={"status": "DELIVERED"}, headers=HDRS)
check("CONFIRMED->DELIVERED -> 200", r.status_code == 200, f"(got {r.status_code})")
r = client.patch("/api/admin/order/1001/status", json={"status": "PLACED"}, headers=HDRS)
check("DELIVERED order cannot go back to PLACED -> 400", r.status_code == 400, f"(got {r.status_code})")
conn = db()
st = conn.execute("SELECT order_status FROM orders WHERE id = 1001").fetchone()[0]
conn.close()
check("status still DELIVERED after rejected revert", st == "DELIVERED", f"(got {st})")

print("\n=== 2. warehouse_inventory restore on cancel ===")

# 2a. Create another CONFIRMED order with warehouse inventory, then cancel it
conn = db()
conn.execute(
    "INSERT INTO orders (id, user_id, total_amount, order_status, dark_store_id, source) VALUES (1002, 1, 200, 'CONFIRMED', 501, 'ONLINE')"
)
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1002, 101, 3, 100)")
conn.commit()
conn.close()

# Sanity: confirm-time decrement behaviour is symmetric (global + warehouse)
# Start: products.stock=50, warehouse_inventory.stock_quantity=10, available_stock=10
# We skip the decrement step here (order already CONFIRMED with stock "reduced"),
# and directly cancel: restore should ADD qty back to BOTH tables.

r = client.patch("/api/admin/order/1002/status", json={"status": "CANCELLED"}, headers=HDRS)
check("CONFIRMED->CANCELLED -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")

conn = db()
prod_stock = conn.execute("SELECT stock FROM products WHERE id = 101").fetchone()[0]
wh_row = conn.execute("SELECT stock_quantity, available_stock FROM warehouse_inventory WHERE warehouse_id = 501 AND product_id = 101").fetchone()
order_st = conn.execute("SELECT order_status FROM orders WHERE id = 1002").fetchone()[0]
conn.close()
check("products.stock restored (+3)", prod_stock == 53, f"(got {prod_stock})")
check("warehouse_inventory.stock_quantity restored (+3)", wh_row[0] == 13, f"(got {wh_row})")
check("warehouse_inventory.available_stock restored (+3)", wh_row[1] == 13, f"(got {wh_row})")
check("order now CANCELLED", order_st == "CANCELLED", f"(got {order_st})")

# 2b. Variant-aware restore: warehouse_inventory row has variant_id
conn = db()
conn.execute("INSERT INTO product_variants (id, product_id, name, price, stock) VALUES (901, 101, 'V1', 100, 20)")
conn.execute(
    "INSERT INTO warehouse_inventory (warehouse_id, warehouse_partner_id, product_id, variant_id, product_name, stock_quantity, available_stock) VALUES (501, 501, 101, 901, 'Test Product', 5, 5)"
)
conn.execute(
    "INSERT INTO orders (id, user_id, total_amount, order_status, dark_store_id, source) VALUES (1003, 1, 100, 'CONFIRMED', 501, 'ONLINE')"
)
conn.execute("INSERT INTO order_items (order_id, product_id, variant_id, quantity, price) VALUES (1003, 101, 901, 1, 100)")
conn.commit()
conn.close()

r = client.patch("/api/admin/order/1003/status", json={"status": "REFUNDED"}, headers=HDRS)
check("CONFIRMED->REFUNDED -> 200", r.status_code == 200, f"(got {r.status_code} {r.get_json()})")
conn = db()
variant_row = conn.execute(
    "SELECT stock_quantity FROM warehouse_inventory WHERE warehouse_id = 501 AND product_id = 101 AND variant_id = 901"
).fetchone()
generic_row = conn.execute(
    "SELECT stock_quantity FROM warehouse_inventory WHERE warehouse_id = 501 AND product_id = 101 AND variant_id IS NULL"
).fetchone()
v_stock = conn.execute("SELECT stock FROM product_variants WHERE id = 901").fetchone()[0]
conn.close()
check("variant warehouse_inventory restored (+1)", variant_row[0] == 6, f"(got {variant_row})")
check("generic row NOT over-restored", generic_row[0] == 13, f"(got {generic_row})")
check("product_variants.stock restored (+1)", v_stock == 21, f"(got {v_stock})")

print("\n=== 3. Partial-decrement rollback on insufficient stock ===")

# A multi-item order where the SECOND item has no stock: confirm must NOT leave
# partial decrements for the FIRST item behind (savepoint all-or-nothing).
conn = db()
conn.execute("INSERT INTO products (id, name, price, stock) VALUES (102, 'No Stock', 50, 0)")
conn.execute(
    "INSERT INTO warehouse_inventory (warehouse_id, warehouse_partner_id, product_id, product_name, stock_quantity, available_stock) VALUES (501, 501, 102, 'No Stock', 0, 0)"
)
conn.execute(
    "INSERT INTO orders (id, user_id, total_amount, order_status, dark_store_id, source) VALUES (1004, 1, 150, 'PLACED', 501, 'ONLINE')"
)
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1004, 101, 2, 100)")
conn.execute("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (1004, 102, 1, 50)")
conn.commit()
conn.close()

from app import confirm_order_and_decrement_stock_logic

conn = db()
before_p101 = conn.execute("SELECT stock FROM products WHERE id = 101").fetchone()[0]
before_wh101 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 101 AND warehouse_id = 501").fetchone()[0]
conn.close()

conn = db()
conn.row_factory = sqlite3.Row
cur = conn.cursor()
raised = False
try:
    confirm_order_and_decrement_stock_logic(cur, 1004)
except ValueError:
    raised = True
conn.rollback()  # simulate caller abandoning the transaction
conn.close()

conn = db()
p101 = conn.execute("SELECT stock FROM products WHERE id = 101").fetchone()[0]
wh101 = conn.execute("SELECT stock_quantity FROM warehouse_inventory WHERE product_id = 101 AND warehouse_id = 501").fetchone()[0]
order_st = conn.execute("SELECT order_status FROM orders WHERE id = 1004").fetchone()[0]
conn.close()
check("confirm raised ValueError on insufficient stock", raised, "(did not raise)")
check("first item stock NOT partially decremented", p101 == before_p101, f"(before={before_p101}, after={p101})")
check("first item warehouse stock NOT partially decremented", wh101 == before_wh101, f"(before={before_wh101}, after={wh101})")
check("order still PLACED (no commit happened)", order_st == "PLACED", f"(got {order_st})")

print("\n" + "=" * 50)
print(f"TOTAL: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", FAIL)
    sys.exit(1)
print("ALL TESTS PASSED ✅")
