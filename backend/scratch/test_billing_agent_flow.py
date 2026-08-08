"""
End-to-end billing-agent flow test.
====================================
Simulates the complete offline-sales cycle against the LOCAL jdlx.db so it is
fully isolated (no live writes):

  1. Ensure "Billing Agent" role exists (vendor-scoped, permissions ["billing"]).
  2. Create a staff member under that role.
  3. Verify the staff-permission JOIN used by require_warehouse_staff_permission.
  4. Verify the offline bill INSERT into orders (source=OFFLINE, agent_id set).
  5. Verify order_items insert + warehouse_inventory stock decrement parse.
  6. Roll everything back - no data written.
"""

import json
import os
import random
import sqlite3
import time

os.environ.setdefault("DATABASE_PATH", "jdlx.db")

DB_PATH = os.environ.get("DATABASE_PATH", "jdlx.db")


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_columns(cursor, table):
    return [r[1] for r in cursor.execute(f"PRAGMA table_info({table})").fetchall()]


def run():
    conn = connect()
    cur = conn.cursor()
    results = []

    try:
        cur.execute("BEGIN IMMEDIATE")

        # 1. Roles table + Billing Agent role
        cols = get_columns(cur, "roles")
        assert "role_id" in cols, "roles table missing role_id"
        assert "vendor_id" in cols, "roles table missing vendor_id"
        assert "permissions" in cols, "roles table missing permissions"
        cur.execute(
            "INSERT INTO roles (vendor_id, role_name, permissions) VALUES (1, 'Billing Agent', ?)",
            (json.dumps(["billing"]),),
        )
        role_id = cur.lastrowid
        results.append(("roles + Billing Agent role created", True))

        # 2. warehouse_staff with billing schema
        staff_cols = get_columns(cur, "warehouse_staff")
        required = ["staff_id", "vendor_id", "role_id", "name", "login_email", "password_hash", "setup_token"]
        assert all(c in staff_cols for c in required), f"warehouse_staff missing columns: {required}"
        cur.execute(
            "INSERT INTO warehouse_staff (vendor_id, role_id, name, login_email, setup_token, setup_token_expires, status) "
            "VALUES (1, ?, 'Test Agent', 'agent@test.com', 'tok123', '2026-01-01 00:00:00', 'active')",
            (role_id,),
        )
        staff_id = cur.lastrowid
        results.append(("warehouse_staff created (billing schema)", True))

        # 3. Staff-permission JOIN (same as require_warehouse_staff_permission)
        row = cur.execute(
            "SELECT ws.staff_id, ws.vendor_id, ws.status, r.permissions "
            "FROM warehouse_staff ws "
            "JOIN roles r ON r.role_id = ws.role_id AND r.vendor_id = ws.vendor_id "
            "WHERE ws.staff_id = ? AND ws.vendor_id = ?",
            (staff_id, 1),
        ).fetchone()
        assert row and row["status"] == "active", "staff permission JOIN failed"
        perms = json.loads(row["permissions"])
        assert "billing" in perms, f"billing permission missing: {perms}"
        results.append(("staff-permission JOIN grants billing", True))

        # 4. Offline bill INSERT into orders (source=OFFLINE, agent_id)
        order_cols = get_columns(cur, "orders")
        assert "vendor_id" in order_cols, "orders missing vendor_id"
        assert "source" in order_cols, "orders missing source"
        assert "agent_id" in order_cols, "orders missing agent_id"
        order_number = f"BILL-TEST-{int(time.time())}-{random.randint(1000, 9999)}"
        # Counter-sales user is created lazily by the backend; use a valid user id here.
        user_row = cur.execute("SELECT id FROM users WHERE email = 'counter@jdlx.internal'").fetchone()
        if not user_row:
            cur.execute(
                "INSERT INTO users (google_id, name, email, role) VALUES ('counter-sales', 'Counter Sales', 'counter@jdlx.internal', 'user')"
            )
            user_id = cur.lastrowid
        else:
            user_id = user_row["id"]
        cur.execute(
            "INSERT INTO orders (order_number, user_id, vendor_id, source, agent_id, customer_name, customer_phone, "
            "delivery_address, total_amount, order_status, payment_status, payment_type) "
            "VALUES (?, ?, 1, 'OFFLINE', ?, 'Counter', '9000000000', 'Store Counter Sale', 1180.0, 'CONFIRMED', 'completed', 'CASH')",
            (order_number, user_id, staff_id),
        )
        order_id = cur.lastrowid
        results.append(("orders INSERT (user_id + OFFLINE + agent_id + address)", True))

        # 5. order_items insert
        item_cols = get_columns(cur, "order_items")
        assert "product_name" in item_cols or "name" in item_cols, "order_items missing name column"
        cur.execute(
            "INSERT INTO order_items (order_id, product_id, product_name, quantity, price, subtotal) "
            "VALUES (?, 1, 'Test Product', 2, 500.0, 1000.0)",
            (order_id,),
        )
        results.append(("order_items INSERT", True))

        # 6. warehouse_inventory stock decrement (same SQL as billing/generate)
        inv_cols = get_columns(cur, "warehouse_inventory")
        assert "stock_quantity" in inv_cols, "warehouse_inventory missing stock_quantity"
        assert "available_stock" in inv_cols, "warehouse_inventory missing available_stock"
        cur.execute(
            "UPDATE warehouse_inventory "
            "SET stock_quantity = CASE WHEN stock_quantity >= 2 THEN stock_quantity - 2 ELSE 0 END, "
            "    available_stock = CASE WHEN available_stock >= 2 THEN available_stock - 2 ELSE 0 END "
            "WHERE warehouse_id = 1 AND product_id = 1"
        )
        results.append(("warehouse_inventory stock decrement", True))

        conn.rollback()
        print("=== BILLING AGENT FLOW: ALL PASSED (rolled back, no data written) ===")
        for name, ok in results:
            print(f"  [{'✅' if ok else '❌'}] {name}")
        print("  [✅] transaction rolled back cleanly")

    except AssertionError as exc:
        conn.rollback()
        print(f"FAILED: {exc}")
        raise
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: {exc}")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    run()
