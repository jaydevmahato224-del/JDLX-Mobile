#!/usr/bin/env python3
"""Verify checkout queries parse + run against the live Turso DB after migration."""
import sys
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from database import get_db, USE_TURSO  # noqa: E402

print("USE_TURSO =", USE_TURSO)
conn = get_db()
c = conn.cursor()

# 1. Checkout warehouse-select query (with variant) - exactly as in app.py
c.execute(
    """SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
    WHERE wi.product_id = ? AND wi.variant_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
      AND w.operations_status = 'open' AND w.account_status = 'active'
    LIMIT 1""",
    (87, None),
)
print("1. SELECT (with variant) -> OK:", c.fetchone())

# 2. Checkout warehouse-select query (without variant)
c.execute(
    """SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
    WHERE wi.product_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
      AND w.operations_status = 'open' AND w.account_status = 'active'
    LIMIT 1""",
    (87,),
)
print("2. SELECT (no variant) -> OK:", c.fetchone())

# 3. Stock decrement / reserve query (from app.py) - runs with delta 0 so no data change
c.execute(
    """UPDATE warehouse_inventory
    SET stock_quantity = stock_quantity - 0, reserved_stock = reserved_stock + 0
    WHERE (warehouse_id = ? OR warehouse_partner_id = ?) AND product_id = ? AND variant_id = ?""",
    (1, 1, 87, None),
)
print("3. Stock decrement UPDATE -> OK (rows touched:", c.rowcount, ")")

# 4. Confirm both columns exist + in sync on live DB
cols = [r[1] for r in c.execute("PRAGMA table_info(warehouse_inventory)").fetchall()]
print("4. Columns:", cols)
assert "warehouse_id" in cols and "warehouse_partner_id" in cols, "Missing column!"

both_null = c.execute(
    "SELECT COUNT(*) FROM warehouse_inventory WHERE warehouse_id IS NULL AND warehouse_partner_id IS NULL"
).fetchone()[0]
mismatch = c.execute(
    "SELECT COUNT(*) FROM warehouse_inventory WHERE warehouse_id IS NOT NULL AND warehouse_partner_id IS NOT NULL AND warehouse_id != warehouse_partner_id"
).fetchone()[0]
print(f"5. Rows with both null: {both_null}, rows with mismatched ids: {mismatch}")
assert both_null == 0, "Some inventory rows lost their warehouse reference!"
assert mismatch == 0, "Some inventory rows point to different warehouses!"

print("ALL LIVE CHECKS PASSED ✔")
conn.close()
