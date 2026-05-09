import sqlite3
import os

db_path = 'jdlx.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, price, stock FROM products")
    print("All Products:")
    for row in cursor.fetchall():
        print(row)
    conn.close()
else:
    print("Database not found")
