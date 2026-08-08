#!/usr/bin/env python3
"""
Migration: Fix "no such column: wi.warehouse_partner_id" during checkout.

Root cause
----------
Commit 5c7e164 renamed the `warehouse_inventory.warehouse_id` column to
`warehouse_partner_id` in database.py's CREATE TABLE. Databases created BEFORE
that commit only have `warehouse_id`. Checkout queries use
`COALESCE(wi.warehouse_id, wi.warehouse_partner_id)`, which fails on older DBs
with "no such column: wi.warehouse_partner_id".

This script:
1. Adds the missing `warehouse_partner_id` column (if absent).
2. Backfills `warehouse_partner_id` from `warehouse_id` (and vice versa) so
   both naming conventions stay in sync.
3. Creates supporting indexes (idempotent).

Safe to run multiple times. Works on local SQLite and Turso (uses get_db()).
"""
import os
import sys

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from database import get_db, USE_TURSO, DATABASE_PATH, TURSO_URL  # noqa: E402


def migrate():
    if USE_TURSO:
        print(f"[MIGRATION] Targeting TURSO database: {TURSO_URL}")
    else:
        print(f"[MIGRATION] Targeting LOCAL SQLite database: {DATABASE_PATH}")
    conn = get_db()
    try:
        cursor = conn.cursor()

        # 1. Inspect existing columns
        cursor.execute("PRAGMA table_info(warehouse_inventory)")
        existing_cols = {row[1] for row in cursor.fetchall()}

        added = []
        if "warehouse_partner_id" not in existing_cols:
            cursor.execute("ALTER TABLE warehouse_inventory ADD COLUMN warehouse_partner_id INTEGER")
            added.append("warehouse_partner_id")
            print("[MIGRATION] Added column: warehouse_inventory.warehouse_partner_id")
        else:
            print("[MIGRATION] warehouse_partner_id column already exists")

        if "warehouse_id" not in existing_cols:
            cursor.execute("ALTER TABLE warehouse_inventory ADD COLUMN warehouse_id INTEGER")
            added.append("warehouse_id")
            print("[MIGRATION] Added column: warehouse_inventory.warehouse_id")
        else:
            print("[MIGRATION] warehouse_id column already exists")

        # 2. Backfill both directions so existing rows reference the same warehouse
        cursor.execute(
            "UPDATE warehouse_inventory SET warehouse_partner_id = warehouse_id "
            "WHERE warehouse_partner_id IS NULL AND warehouse_id IS NOT NULL"
        )
        synced_to_partner = cursor.rowcount
        cursor.execute(
            "UPDATE warehouse_inventory SET warehouse_id = warehouse_partner_id "
            "WHERE warehouse_id IS NULL AND warehouse_partner_id IS NOT NULL"
        )
        synced_to_id = cursor.rowcount

        # 3. Indexes (idempotent)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_wh ON warehouse_inventory(warehouse_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_partner ON warehouse_inventory(warehouse_partner_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_wh_inv_prod ON warehouse_inventory(product_id)")

        conn.commit()

        # 4. Verify the checkout query now parses
        verify_query = """
            SELECT COALESCE(wi.warehouse_id, wi.warehouse_partner_id) as wh_id
            FROM warehouse_inventory wi
            JOIN warehouses w ON w.id = COALESCE(wi.warehouse_id, wi.warehouse_partner_id)
            WHERE wi.product_id = -1
            LIMIT 1
        """
        try:
            cursor.execute(verify_query)
            print("[MIGRATION] Checkout warehouse-select query parses OK (no more 'no such column' error)")
        except Exception as e:
            print(f"[MIGRATION] WARNING: verify query still failing: {e}")

        print("[MIGRATION] Complete.")
        print(f"  - Columns added: {added or 'none'}")
        print(f"  - Rows synced warehouse_id -> warehouse_partner_id: {synced_to_partner}")
        print(f"  - Rows synced warehouse_partner_id -> warehouse_id: {synced_to_id}")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(migrate())
