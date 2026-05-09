import sqlite3
import os

db_path = 'jdlx.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, device_customization_enabled FROM categories")
    print("Categories:")
    for row in cursor.fetchall():
        print(row)
    
    cursor.execute("SELECT id, name, category_id, stock FROM products LIMIT 20")
    print("\nSome Products:")
    for row in cursor.fetchall():
        print(row)
    conn.close()
else:
    print("Database not found")
