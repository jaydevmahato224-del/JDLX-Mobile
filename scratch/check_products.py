import sqlite3
import os

db_path = 'jdlx.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, device_customization_enabled FROM categories")
    categories = cursor.fetchall()
    for cat in categories:
        print(cat)
    
    print("\nProducts in cart (approx):")
    cursor.execute("SELECT id, name, category_id, stock FROM products WHERE name LIKE '%Redmi%' OR name LIKE '%sticker%'")
    products = cursor.fetchall()
    for p in products:
        print(p)
    conn.close()
else:
    print("Database not found")
