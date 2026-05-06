import sqlite3
import os

db_path = 'jdlx.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(products);")
    cols = cursor.fetchall()
    print("Products Table Columns:")
    for col in cols:
        print(col)
    
    cursor.execute("PRAGMA table_info(warehouse_inventory);")
    cols = cursor.fetchall()
    print("\nWarehouse Inventory Table Columns:")
    for col in cols:
        print(col)
    
    conn.close()
else:
    print("Database not found")
