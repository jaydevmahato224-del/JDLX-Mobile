import sqlite3

db_path = "/home/jaydev/Desktop/JDLX-Mobile/jdlx.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    print("Migrating database...")
    
    # Add quick_mode_enabled to warehouses
    try:
        cursor.execute("ALTER TABLE warehouses ADD COLUMN quick_mode_enabled INTEGER DEFAULT 0")
        print("Added quick_mode_enabled to warehouses")
    except sqlite3.OperationalError:
        print("quick_mode_enabled already exists in warehouses")

    # Add quick_mode_enabled to dark_stores
    try:
        cursor.execute("ALTER TABLE dark_stores ADD COLUMN quick_mode_enabled INTEGER DEFAULT 0")
        print("Added quick_mode_enabled to dark_stores")
    except sqlite3.OperationalError:
        print("quick_mode_enabled already exists in dark_stores")

    # Also check warehouse_partners table if it exists
    try:
        cursor.execute("PRAGMA table_info(warehouse_partners)")
        cols = [c[1] for c in cursor.fetchall()]
        if cols and "quick_mode_enabled" not in cols:
             cursor.execute("ALTER TABLE warehouse_partners ADD COLUMN quick_mode_enabled INTEGER DEFAULT 0")
             print("Added quick_mode_enabled to warehouse_partners")
    except sqlite3.OperationalError:
        pass

    conn.commit()
    print("Migration completed successfully.")

except Exception as e:
    print(f"Migration failed: {e}")
    conn.rollback()
finally:
    conn.close()
