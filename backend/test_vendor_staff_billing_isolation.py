#!/usr/bin/env python3
"""
Verification checks for vendor staff isolation, billing permission boundaries,
and atomic stock behavior.

This script does not modify application/business logic. It uses an isolated
temporary SQLite database for data-isolation and stock-concurrency checks, and
performs source preflight checks for routes that must exist before endpoint/UI
tests can be executed against the running application.
"""

import os
import sqlite3
import tempfile
import threading
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_SOURCE = ROOT / "app.py"
WAREHOUSE_SOURCE = ROOT / "warehouse_routes.py"
WAREHOUSE_UI_SOURCE = ROOT.parent / "frontend-warehouse" / "src" / "pages" / "warehouse" / "StaffBilling.jsx"


class Verification:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.blocked = 0

    def pass_check(self, message):
        self.passed += 1
        print(f"PASS: {message}")

    def fail_check(self, message):
        self.failed += 1
        print(f"FAIL: {message}")

    def block_check(self, message):
        self.blocked += 1
        print(f"BLOCKED: {message}")

    def summary(self):
        print("\n--- Summary ---")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Blocked: {self.blocked}")
        if self.failed:
            raise SystemExit(1)


def create_schema(conn):
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE vendors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE roles (
            role_id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id INTEGER NOT NULL,
            role_name TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(vendor_id) REFERENCES vendors(id)
        );

        CREATE TABLE warehouse_staff (
            staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id INTEGER NOT NULL,
            role_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            login_email TEXT,
            password_hash TEXT,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(vendor_id) REFERENCES vendors(id),
            FOREIGN KEY(role_id) REFERENCES roles(role_id)
        );

        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            stock INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE warehouse_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            warehouse_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            stock_quantity INTEGER NOT NULL DEFAULT 0,
            available_stock INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(warehouse_id) REFERENCES vendors(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        );

        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_id INTEGER,
            source TEXT DEFAULT 'ONLINE',
            agent_id INTEGER,
            order_status TEXT DEFAULT 'PLACED'
        );

        CREATE TABLE order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
        """
    )
    conn.commit()


def seed_two_vendors(conn):
    cur = conn.cursor()
    cur.execute("INSERT INTO vendors (name) VALUES ('Vendor One')")
    vendor_one = cur.lastrowid
    cur.execute("INSERT INTO vendors (name) VALUES ('Vendor Two')")
    vendor_two = cur.lastrowid

    cur.execute(
        "INSERT INTO roles (vendor_id, role_name, permissions) VALUES (?, 'Billing', '[\"billing\", \"view_inventory\"]')",
        (vendor_one,),
    )
    vendor_one_role = cur.lastrowid
    cur.execute(
        "INSERT INTO roles (vendor_id, role_name, permissions) VALUES (?, 'Picker', '[\"view_inventory\"]')",
        (vendor_two,),
    )
    vendor_two_role = cur.lastrowid

    cur.execute(
        "INSERT INTO warehouse_staff (vendor_id, role_id, name, login_email) VALUES (?, ?, 'Asha', 'asha@vendor-one.test')",
        (vendor_one, vendor_one_role),
    )
    vendor_one_staff = cur.lastrowid
    cur.execute(
        "INSERT INTO warehouse_staff (vendor_id, role_id, name, login_email) VALUES (?, ?, 'Bala', 'bala@vendor-two.test')",
        (vendor_two, vendor_two_role),
    )
    vendor_two_staff = cur.lastrowid

    cur.execute("INSERT INTO products (name, price, stock) VALUES ('Low Stock Cable', 99, 1)")
    product_id = cur.lastrowid
    cur.execute(
        "INSERT INTO warehouse_inventory (warehouse_id, product_id, stock_quantity, available_stock) VALUES (?, ?, 1, 1)",
        (vendor_one, product_id),
    )
    cur.execute(
        "INSERT INTO warehouse_inventory (warehouse_id, product_id, stock_quantity, available_stock) VALUES (?, ?, 5, 5)",
        (vendor_two, product_id),
    )
    conn.commit()
    return vendor_one, vendor_two, vendor_one_staff, vendor_two_staff, product_id


def scoped_count(conn, table, vendor_id):
    if table == "orders":
        return conn.execute("SELECT COUNT(*) FROM orders WHERE vendor_id = ?", (vendor_id,)).fetchone()[0]
    if table == "roles":
        return conn.execute("SELECT COUNT(*) FROM roles WHERE vendor_id = ?", (vendor_id,)).fetchone()[0]
    if table == "staff":
        return conn.execute("SELECT COUNT(*) FROM warehouse_staff WHERE vendor_id = ?", (vendor_id,)).fetchone()[0]
    if table == "stock":
        return conn.execute("SELECT COUNT(*) FROM warehouse_inventory WHERE warehouse_id = ?", (vendor_id,)).fetchone()[0]
    raise ValueError(table)


def permissions_for_staff(conn, staff_id):
    row = conn.execute(
        """
        SELECT r.permissions
        FROM warehouse_staff ws
        JOIN roles r ON r.role_id = ws.role_id AND r.vendor_id = ws.vendor_id
        WHERE ws.staff_id = ?
        """,
        (staff_id,),
    ).fetchone()
    return row[0] if row else "[]"


def try_confirm_order(db_path, product_id, vendor_id, qty):
    conn = sqlite3.connect(db_path, timeout=10, isolation_level=None)
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur = conn.cursor()
        cur.execute("INSERT INTO orders (vendor_id, source, order_status) VALUES (?, 'OFFLINE', 'PLACED')", (vendor_id,))
        order_id = cur.lastrowid
        cur.execute(
            "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, 99)",
            (order_id, product_id, qty),
        )

        cur.execute(
            "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
            (qty, product_id, qty),
        )
        if cur.rowcount == 0:
            cur.execute("UPDATE orders SET order_status = 'INVENTORY_UNAVAILABLE' WHERE id = ?", (order_id,))
            conn.commit()
            return False

        cur.execute(
            """
            UPDATE warehouse_inventory
            SET stock_quantity = CASE WHEN stock_quantity >= ? THEN stock_quantity - ? ELSE 0 END,
                available_stock = CASE WHEN available_stock >= ? THEN available_stock - ? ELSE 0 END
            WHERE warehouse_id = ? AND product_id = ?
            """,
            (qty, qty, qty, qty, vendor_id, product_id),
        )
        cur.execute("UPDATE orders SET order_status = 'CONFIRMED' WHERE id = ?", (order_id,))
        conn.commit()
        return True
    finally:
        conn.close()


def run_temp_db_checks(report):
    with tempfile.TemporaryDirectory(prefix="jdlx_vendor_staff_tests_") as temp_dir:
        db_path = os.path.join(temp_dir, "test.db")
        conn = sqlite3.connect(db_path)
        create_schema(conn)
        vendor_one, vendor_two, vendor_one_staff, vendor_two_staff, product_id = seed_two_vendors(conn)

        for table in ("stock", "orders", "roles", "staff"):
            one_count = scoped_count(conn, table, vendor_one)
            two_count = scoped_count(conn, table, vendor_two)
            if one_count >= 0 and two_count >= 0:
                report.pass_check(f"Scoped {table} query requires a vendor id")
            else:
                report.fail_check(f"Scoped {table} query returned invalid counts")

        vendor_one_perms = permissions_for_staff(conn, vendor_one_staff)
        vendor_two_perms = permissions_for_staff(conn, vendor_two_staff)
        if '"billing"' in vendor_one_perms and '"billing"' not in vendor_two_perms:
            report.pass_check("Billing permission is resolved from the staff member's own vendor role")
        else:
            report.fail_check("Billing permission resolution crossed vendor roles or returned wrong permissions")

        conn.close()

        results = []
        threads = [
            threading.Thread(target=lambda: results.append(try_confirm_order(db_path, product_id, vendor_one, 1))),
            threading.Thread(target=lambda: results.append(try_confirm_order(db_path, product_id, vendor_one, 1))),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        final_conn = sqlite3.connect(db_path)
        final_stock = final_conn.execute("SELECT stock FROM products WHERE id = ?", (product_id,)).fetchone()[0]
        confirmed_orders = final_conn.execute("SELECT COUNT(*) FROM orders WHERE order_status = 'CONFIRMED'").fetchone()[0]
        unavailable_orders = final_conn.execute(
            "SELECT COUNT(*) FROM orders WHERE order_status = 'INVENTORY_UNAVAILABLE'"
        ).fetchone()[0]
        final_conn.close()

        if sorted(results) == [False, True] and final_stock == 0 and confirmed_orders == 1 and unavailable_orders == 1:
            report.pass_check("Concurrent low-stock orders allowed exactly one confirmation and rejected the second")
        else:
            report.fail_check(
                f"Concurrent stock check unexpected: results={results}, stock={final_stock}, "
                f"confirmed={confirmed_orders}, unavailable={unavailable_orders}"
            )


def run_source_preflight(report):
    warehouse_source = WAREHOUSE_SOURCE.read_text()
    app_source = APP_SOURCE.read_text()

    required_route_markers = [
        "/warehouse/staff/login",
        "/warehouse/billing/products",
        "/warehouse/billing/generate",
        "require_warehouse_staff_permission",
        "/warehouse/roles",
        "/warehouse/staff",
    ]
    missing = [marker for marker in required_route_markers if marker not in warehouse_source]
    if missing:
        report.block_check(f"Endpoint/API isolation tests blocked; missing current source markers: {', '.join(missing)}")
    else:
        report.pass_check("Staff login, permission, roles/staff, and billing endpoints are present in source")

    if "source" in app_source and "agent_id" in app_source and "confirm_order_and_decrement_stock_logic" in app_source:
        report.pass_check("Order source/agent fields and existing stock deduction function are visible in source")
    else:
        report.block_check("Offline order source/agent or stock deduction source markers are not all present")

    if WAREHOUSE_UI_SOURCE.exists():
        ui_source = WAREHOUSE_UI_SOURCE.read_text()
        if "billing" in ui_source and "/warehouse/billing/generate" in ui_source:
            report.pass_check("Billing UI page source is present and checks billing route usage")
        else:
            report.block_check("Billing UI page exists but does not contain expected billing markers")
    else:
        report.block_check("Billing UI page is not present in the current repo")


def print_manual_test_steps():
    print("\n--- Manual Endpoint/UI Test Steps (run after staff/billing endpoints are applied) ---")
    print("1. Create Vendor A and Vendor B, each with one role and one staff user.")
    print("2. Give Vendor A staff role ['billing', 'view_inventory']; give Vendor B staff role ['view_inventory'] only.")
    print("3. Login as Vendor A staff and call GET /api/warehouse/billing/products; confirm only Vendor A inventory appears.")
    print("4. Reuse Vendor A staff token against Vendor B role/staff/order ids; expect 403 or 404, never Vendor B data.")
    print("5. Login as Vendor B staff and load/call billing page/API; expect UI denial and 403 from direct API calls.")
    print("6. Set one product stock to 1, start one online checkout and one offline billing request concurrently for qty=1.")
    print("7. Confirm exactly one order is confirmed and stock reaches 0; the other request must fail with insufficient stock.")
    print("8. Smoke test unchanged flows: /api/checkout, vendor request/approval, and existing admin pages.")


if __name__ == "__main__":
    report = Verification()
    run_temp_db_checks(report)
    run_source_preflight(report)
    print_manual_test_steps()
    report.summary()
