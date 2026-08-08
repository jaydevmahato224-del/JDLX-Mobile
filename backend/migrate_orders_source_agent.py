#!/usr/bin/env python3
"""
Migration: Fix "table orders has no column named source" during order placement.

Root cause
----------
Order placement (app.py checkout) inserts `source` and `agent_id` columns into
`orders` (VALUES 'ONLINE', NULL), but databases created before the vendor-staff
billing feature only have the original orders columns. The
`migrate_vendor_staff_billing.py` script adds them, but it was never run against
existing DBs, and database.py's ensure_columns did not include them either.

This script:
1. Adds `source TEXT DEFAULT 'ONLINE'` to orders (if absent).
2. Adds `agent_id INTEGER` to orders (if absent).
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

        cursor.execute("PRAGMA table_info(orders)")
        existing_cols = {row[1] for row in cursor.fetchall()}

        if "source" not in existing_cols:
            cursor.execute("ALTER TABLE orders ADD COLUMN source TEXT DEFAULT 'ONLINE'")
            print("[MIGRATION] Added column: orders.source")
        else:
            print("[MIGRATION] orders.source already exists")

        if "agent_id" not in existing_cols:
            cursor.execute("ALTER TABLE orders ADD COLUMN agent_id INTEGER")
            print("[MIGRATION] Added column: orders.agent_id")
        else:
            print("[MIGRATION] orders.agent_id already exists")

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(agent_id)")

        conn.commit()

        # Verify: the exact checkout INSERT column list now parses.
        # EXPLAIN never writes data, so this check is side-effect free.
        try:
            cursor.execute(
                """
                EXPLAIN INSERT INTO orders (
                    order_number, user_id, customer_name, customer_phone, delivery_address,
                    order_status, total_amount, dark_store_id, estimated_delivery,
                    delivery_latitude, delivery_longitude, payment_status, delivery_type,
                    platform_fee, delivery_fee, fitting_charge, payment_type,
                    cod_advance_paid, cod_remaining_amount, free_delivery_applied,
                    source, agent_id
                )
                VALUES ('X', -1, 'CHECK', '', '', 'PLACED', 0, NULL, NULL,
                        NULL, NULL, 'pending', 'quick', 0, 0, 0, 'PREPAID', 0, 0, 0,
                        'ONLINE', NULL)
                """
            )
            print("[MIGRATION] Checkout INSERT parses OK (EXPLAIN, no data written)")
        except Exception as e:
            print(f"[MIGRATION] WARNING: checkout INSERT still failing: {e}")

        # Re-verify with fresh PRAGMA
        cursor.execute("PRAGMA table_info(orders)")
        cols = [row[1] for row in cursor.fetchall()]
        print(f"[MIGRATION] orders columns now: {cols}")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
