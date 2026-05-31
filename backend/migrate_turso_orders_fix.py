"""
Migration: Fix CHECK constraints on orders table in Turso production database.

Problem:
  The Turso orders table has outdated CHECK constraints:
    - order_status IN ('pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'cancelled')
    - payment_status IN ('pending', 'paid', 'failed')
  But the app uses 'PLACED', 'CONFIRMED', 'ADVANCE_PAID', etc. — causing INSERT failures.

  Also fixes: id column is TEXT PRIMARY KEY in Turso but should be INTEGER PRIMARY KEY AUTOINCREMENT.

Solution:
  1. Rename old table
  2. Create new table WITHOUT restrictive CHECK constraints
  3. Copy any existing data
  4. Drop old table
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

from database import get_db, USE_TURSO

def migrate():
    if not USE_TURSO:
        print("⚠️  Not connected to Turso. This migration is for the Turso production database.")
        print("   Make sure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set in .env")
        return False

    conn = get_db()
    cursor = conn.cursor()

    print("=== Turso Orders Table CHECK Constraint Migration ===")
    print(f"Connected to Turso: {USE_TURSO}")

    # Step 1: Check current schema
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'")
    row = cursor.fetchone()
    if not row:
        print("❌ Orders table not found in Turso!")
        conn.close()
        return False

    current_sql = row[0] if isinstance(row, tuple) else row['sql']
    print(f"\nCurrent schema:\n{current_sql}\n")

    if "CHECK" not in current_sql:
        print("✅ No CHECK constraints found — table is already migrated!")
        conn.close()
        return True

    # Step 2: Count existing rows
    cursor.execute("SELECT COUNT(*) as cnt FROM orders")
    count_row = cursor.fetchone()
    existing_count = count_row[0] if isinstance(count_row, tuple) else count_row['cnt']
    print(f"Existing orders count: {existing_count}")

    # Step 3: Rename old table
    print("\n1. Renaming orders -> orders_old_turso_backup...")
    try:
        cursor.execute("ALTER TABLE orders RENAME TO orders_old_turso_backup")
        conn.commit() # Ensure rename is persisted
    except Exception as e:
        print(f"   Error renaming: {e}")
        # Try dropping existing backup first
        try:
            cursor.execute("DROP TABLE IF EXISTS orders_old_turso_backup")
            cursor.execute("ALTER TABLE orders RENAME TO orders_old_turso_backup")
            conn.commit()
        except Exception as e2:
            print(f"   Fatal error: {e2}")
            conn.close()
            return False

    # Re-open connection or sync if needed for Turso
    if hasattr(conn, 'sync'):
        conn.sync()

    # Step 4: Create new table WITHOUT CHECK constraints
    print("2. Creating new orders table without CHECK constraints...")
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
        shipped_at TIMESTAMP,
        cancellation_reason TEXT
    )''')
    conn.commit()

    # Step 5: Copy existing data if any
    if existing_count > 0:
        print(f"3. Copying {existing_count} rows from backup...")
        try:
            # Verify backup table exists before querying
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='orders_old_turso_backup'")
            if not cursor.fetchone():
                print("❌ Backup table orders_old_turso_backup not found after rename!")
                return False

            # Get columns from the old backup table
            cursor.execute("PRAGMA table_info(orders_old_turso_backup)")
            old_columns = [row[1] if isinstance(row, tuple) else row['name'] for row in cursor.fetchall()]

            cursor.execute("PRAGMA table_info(orders)")
            new_columns = [row[1] if isinstance(row, tuple) else row['name'] for row in cursor.fetchall()]

            # Find common columns (excluding 'id' since type changed from TEXT to INTEGER)
            common = [c for c in old_columns if c in new_columns and c != 'id']
            cols_str = ', '.join(common)

            cursor.execute(f'''INSERT INTO orders ({cols_str})
                SELECT {cols_str} FROM orders_old_turso_backup''')
            
            cursor.execute("SELECT COUNT(*) as cnt FROM orders")
            new_count_row = cursor.fetchone()
            new_count = new_count_row[0] if isinstance(new_count_row, tuple) else new_count_row['cnt']
            print(f"   Copied {new_count}/{existing_count} rows")

            if new_count != existing_count:
                print("   ⚠️  Row count mismatch! Rolling back...")
                cursor.execute("DROP TABLE orders")
                cursor.execute("ALTER TABLE orders_old_turso_backup RENAME TO orders")
                conn.commit()
                conn.close()
                return False
        except Exception as e:
            print(f"   Error copying data: {e}")
            print("   Rolling back...")
            try:
                cursor.execute("DROP TABLE IF EXISTS orders")
                cursor.execute("ALTER TABLE orders_old_turso_backup RENAME TO orders")
            except Exception:
                pass
            conn.commit()
            conn.close()
            return False
    else:
        print("3. No existing data to copy.")

    # Step 6: Drop backup
    print("4. Dropping backup table...")
    cursor.execute("DROP TABLE IF EXISTS orders_old_turso_backup")

    # Step 7: Verify new schema
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'")
    new_row = cursor.fetchone()
    new_sql = new_row[0] if isinstance(new_row, tuple) else new_row['sql']
    print(f"\nNew schema:\n{new_sql}\n")

    has_check = "CHECK" in new_sql
    if has_check:
        print("❌ CHECK constraint still exists!")
        conn.commit()
        conn.close()
        return False

    conn.commit()
    conn.close()
    print("✅ Migration complete! CHECK constraints removed from orders table.")
    print("   App values (PLACED, CONFIRMED, ADVANCE_PAID, etc.) will now be accepted.")
    return True


if __name__ == '__main__':
    success = migrate()
    sys.exit(0 if success else 1)
