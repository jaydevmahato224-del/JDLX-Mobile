"""
Verifies the fixed checkout warehouse-select queries against the LIVE Turso DB.
Uses the exact SQL text that app.py now executes (single-quoted literals).
"""
import sys
sys.path.insert(0, ".")
from database import get_db, USE_TURSO

print(f"USE_TURSO = {USE_TURSO}")

conn = get_db()
c = conn.cursor()

# --- Query 1: with variant (the exact fixed SQL from app.py line ~3152) ---
Q1 = """
    SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
    WHERE wi.product_id = ? AND wi.variant_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
      AND w.operations_status = 'open' AND w.account_status = 'active'
    LIMIT 1
"""
try:
    c.execute(Q1, (87, None))
    print("1. SELECT(variant, single-quoted) PARSE OK:", c.fetchone())
except Exception as e:
    print("1. FAILED:", e)

# --- Query 2: without variant (the exact fixed SQL from app.py line ~3166) ---
Q2 = """
    SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
    WHERE wi.product_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
      AND w.operations_status = 'open' AND w.account_status = 'active'
    LIMIT 1
"""
try:
    c.execute(Q2, (87,))
    print("2. SELECT(no-variant, single-quoted) PARSE OK:", c.fetchone())
except Exception as e:
    print("2. FAILED:", e)

# --- Confirm the OLD double-quoted version fails (proves root cause) ---
OLD = """
    SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
    FROM warehouse_inventory wi
    JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
    WHERE wi.product_id = ? AND (wi.stock_quantity > 0 OR wi.available_stock > 0)
      AND w.operations_status = "open" AND w.account_status = "active"
    LIMIT 1
"""
try:
    c.execute(OLD, (87,))
    print("3. OLD double-quoted version: unexpectedly PARSE OK (Turso lenient)")
except Exception as e:
    print("3. OLD double-quoted version FAILS as expected ->", str(e)[:120])

conn.close()
