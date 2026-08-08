#!/usr/bin/env python3
"""Print actual live Turso warehouse + inventory values to diagnose the 0 open/active warehouses issue."""
import sys
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from database import get_db  # noqa: E402

conn = get_db()
c = conn.cursor()

print("== warehouses (as dict) ==")
try:
    rows = c.execute(
        "SELECT id, warehouse_name, operations_status, account_status, weather_status, quick_mode_enabled FROM warehouses"
    ).fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print("error:", e)

print("\n== warehouse_inventory (as dict, top 15) ==")
try:
    rows = c.execute(
        "SELECT id, warehouse_id, warehouse_partner_id, product_id, product_name, stock_quantity, available_stock, variant_id FROM warehouse_inventory LIMIT 15"
    ).fetchall()
    for r in rows:
        print(dict(r))
except Exception as e:
    print("error:", e)

print("\n== how many products exist in products table ==")
try:
    print("products count:", c.execute("SELECT COUNT(*) FROM products").fetchone()[0])
except Exception as e:
    print("error:", e)

conn.close()
