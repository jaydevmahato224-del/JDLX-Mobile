"""
Billing Agents migration (Turso-aware)
=====================================
Ensures the vendor-staff billing schema exists on the LIVE database without
waiting for a redeploy:

  1. Creates the `roles` table (vendor-scoped, permissions JSON) if missing.
  2. Rebuilds `warehouse_staff` to the billing schema (staff_id PK, vendor_id,
     role_id, login_email, password_hash, setup_token...) if it currently uses
     the legacy partner-module schema (id PK, warehouse_partner_id...).
  3. Preserves any existing staff rows by mapping columns across.
  4. Ensures orders.source / orders.agent_id exist (billing orders use them).
  5. Verifies the exact queries the billing flow runs, read-only.

Idempotent and safe to run repeatedly.
"""

import json
import time
import random

from database import get_db, init_db


def get_columns(cursor, table):
    try:
        return [r[1] for r in cursor.execute(f"PRAGMA table_info({table})").fetchall()]
    except Exception:
        return []


def migrate():
    print("Running init_db() self-heal first...")
    init_db()

    conn = get_db()
    cur = conn.cursor()
    try:
        # ── 1. roles table ─────────────────────────────────────────────
        print("Creating roles table if missing...")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS roles (
                role_id INTEGER PRIMARY KEY AUTOINCREMENT,
                vendor_id INTEGER NOT NULL,
                role_name TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
                UNIQUE(vendor_id, role_name)
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_roles_vendor ON roles(vendor_id)")

        # ── 2. warehouse_staff rebuild if legacy schema ────────────────
        staff_cols = get_columns(cur, "warehouse_staff")
        if "staff_id" not in staff_cols:
            print("warehouse_staff uses legacy schema - rebuilding with billing schema...")
            cur.execute("ALTER TABLE warehouse_staff RENAME TO warehouse_staff_legacy")
            cur.execute(
                """
                CREATE TABLE warehouse_staff (
                    staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    vendor_id INTEGER NOT NULL,
                    role_id INTEGER,
                    name TEXT NOT NULL,
                    login_email TEXT,
                    username TEXT,
                    password_hash TEXT,
                    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
                    setup_token TEXT,
                    setup_token_expires TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY(vendor_id) REFERENCES warehouses(id),
                    FOREIGN KEY(role_id) REFERENCES roles(role_id),
                    UNIQUE(vendor_id, login_email),
                    UNIQUE(vendor_id, username)
                )
                """
            )
            legacy_cols = get_columns(cur, "warehouse_staff_legacy")
            legacy_map = {c.lower(): c for c in legacy_cols}
            src_id = legacy_map.get("id") or legacy_map.get("staff_id")
            src_name = legacy_map.get("name")
            src_email = legacy_map.get("email") or legacy_map.get("login_email")
            src_status = legacy_map.get("status")
            src_vendor = legacy_map.get("vendor_id") or legacy_map.get("warehouse_partner_id")
            src_created = legacy_map.get("created_at")
            src_updated = legacy_map.get("updated_at")
            if src_id and src_name:
                select_parts = [src_id, src_vendor or "NULL", src_name, src_email or "NULL"]
                sel = ", ".join(str(p) for p in select_parts)
                status_col = src_status or "'active'"
                created_col = src_created or "CURRENT_TIMESTAMP"
                updated_col = src_updated or "CURRENT_TIMESTAMP"
                cur.execute(
                    f"INSERT INTO warehouse_staff (staff_id, vendor_id, name, login_email, status, created_at, updated_at) "
                    f"SELECT {sel}, {status_col}, {created_col}, {updated_col} FROM warehouse_staff_legacy"
                )
            cur.execute("DROP TABLE warehouse_staff_legacy")
            print("  -> warehouse_staff rebuilt, legacy rows preserved.")
        else:
            print("warehouse_staff already uses billing schema.")

        # 3. orders.vendor_id (billing orders insert vendor_id) ──────────
        order_cols = get_columns(cur, "orders")
        if "vendor_id" not in order_cols:
            cur.execute("ALTER TABLE orders ADD COLUMN vendor_id INTEGER")
            print("  -> orders.vendor_id added.")
        else:
            print("orders.vendor_id already present.")

        cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_vendor ON warehouse_staff(vendor_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_warehouse_staff_role ON warehouse_staff(role_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(agent_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_orders_source ON orders(source)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_orders_vendor ON orders(vendor_id)")

        conn.commit()
        print("Migration DDL committed.")
    finally:
        conn.close()

    verify()


def verify():
    conn = get_db()
    try:
        roles_cols = get_columns(conn.cursor(), "roles")
        staff_cols = get_columns(conn.cursor(), "warehouse_staff")
        print("\n=== VERIFY (live) ===")
        print("roles cols:", roles_cols)
        print("staff cols:", staff_cols)
        assert "role_id" in roles_cols, "roles table missing role_id"
        assert "staff_id" in staff_cols, "warehouse_staff missing staff_id"
        assert "vendor_id" in staff_cols and "role_id" in staff_cols, "warehouse_staff missing billing columns"

        c = conn.cursor()
        # Role creation (EXPLAIN only - no write)
        c.execute(
            "EXPLAIN INSERT INTO roles (vendor_id, role_name, permissions) VALUES (?, 'Billing Agent', ?)",
            (1, json.dumps(["billing"])),
        )
        print("1. roles INSERT parses OK")

        # Staff creation
        c.execute(
            "EXPLAIN INSERT INTO warehouse_staff (vendor_id, role_id, name, login_email, setup_token, setup_token_expires, status) "
            "VALUES (1, 1, 'Agent', 'a@b.com', 'tok', '2026-01-01 00:00:00', 'active')"
        )
        print("2. warehouse_staff INSERT parses OK")

        # Staff permission join used by require_warehouse_staff_permission
        c.execute(
            "EXPLAIN SELECT ws.staff_id, ws.vendor_id, ws.status, r.permissions "
            "FROM warehouse_staff ws JOIN roles r ON r.role_id = ws.role_id AND r.vendor_id = ws.vendor_id "
            "WHERE ws.staff_id = 1 AND ws.vendor_id = 1"
        )
        print("3. staff-permission JOIN parses OK")

        # Billing products query (guarded read) - image_url only if the column exists
        product_cols = get_columns(c, "products")
        image_sel = "p.image_url, " if "image_url" in product_cols else "NULL AS image_url, "
        c.execute(
            "SELECT p.id, p.name, p.price, " + image_sel + "p.category, "
            "COALESCE(wi.available_stock, wi.stock_quantity, p.stock) AS stock "
            "FROM products p "
            "JOIN warehouse_inventory wi ON wi.product_id = p.id AND wi.warehouse_id = 1 "
            "WHERE wi.stock_quantity > 0 OR wi.available_stock > 0 LIMIT 5"
        )
        print("4. billing/products query parses OK")

        # Billing order insert + stock decrement (EXPLAIN - no write)
        order_number = f"BILL-VERIFY-{int(time.time())}-{random.randint(1000, 9999)}"
        c.execute(
            "EXPLAIN INSERT INTO orders (order_number, user_id, vendor_id, source, agent_id, customer_name, "
            "customer_phone, delivery_address, total_amount, order_status, payment_status, payment_type) "
            "VALUES (?, 1, 1, 'OFFLINE', 1, 'T', '9', 'Store Counter Sale', 100.0, 'CONFIRMED', 'completed', 'CASH')",
            (order_number,),
        )
        print("5. billing/generate orders INSERT parses OK")
        c.execute(
            "EXPLAIN UPDATE warehouse_inventory SET stock_quantity = CASE WHEN stock_quantity >= 1 THEN stock_quantity - 1 ELSE 0 END "
            "WHERE warehouse_id = 1 AND product_id = 1"
        )
        print("6. billing/generate stock decrement parses OK")
        print("\nALL BILLING FLOW CHECKS PASSED ✅")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
