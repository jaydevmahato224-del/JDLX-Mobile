#!/usr/bin/env python3
"""Check live Turso warehouse inventory data health - are there open/active warehouses with stock?"""
import sys
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from database import get_db  # noqa: E402

conn = get_db()
c = conn.cursor()

print("== warehouses table ==")
cols = [r[1] for r in c.execute("PRAGMA table_info(warehouses)").fetchall()]
print("cols:", cols)
try:
    rows = c.execute("SELECT id, warehouse_name, operations_status, account_status FROM warehouses LIMIT 20").fetchall()
    print("warehouses:", rows)
except Exception as e:
    print("warehouse query error:", e)

print("\n== warehouse_inventory summary ==")
try:
    print("total rows:", c.execute("SELECT COUNT(*) FROM warehouse_inventory").fetchone()[0])
    print("rows with stock>0:", c.execute("SELECT COUNT(*) FROM warehouse_inventory WHERE stock_quantity > 0 OR available_stock > 0").fetchone()[0])
    print("distinct product_ids:", c.execute("SELECT COUNT(DISTINCT product_id) FROM warehouse_inventory").fetchone()[0])
    print("sample rows:")
    for r in c.execute(
        "SELECT id, warehouse_id, product_id, product_name, stock_quantity, available_stock FROM warehouse_inventory LIMIT 10"
    ).fetchall():
        print("   ", r)
except Exception as e:
    print("inventory query error:", e)

print("\n== join: inventory rows whose warehouse is open+active ==")
try:
    rows = c.execute(
        """SELECT COUNT(*)
        FROM warehouse_inventory wi
        JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
        WHERE (wi.stock_quantity > 0 OR wi.available_stock > 0)
          AND w.operations_status = 'open' AND w.account_status = 'active'"""
    ).fetchone()
    print("open+active warehouses with stock:", rows[0])
except Exception as e:
    print("join query error:", e)

conn.close()
