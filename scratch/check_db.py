import sqlite3
import os

db_path = "/home/jaydev/Desktop/JDLX-Mobile/jdlx.db"
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

try:
    print("--- Warehouses ---")
    rows = cursor.execute("SELECT id, warehouse_name, operations_status, quick_mode_enabled FROM warehouses").fetchall()
    for row in rows:
        print(dict(row))

    print("\n--- Dark Stores ---")
    rows = cursor.execute("SELECT id, name, active, quick_mode_enabled FROM dark_stores").fetchall()
    for row in rows:
        print(dict(row))

    print("\n--- Warehouse Partners ---")
    rows = cursor.execute("SELECT id, warehouse_name, operations_status FROM warehouse_partners").fetchall()
    for row in rows:
        print(dict(row))

except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
