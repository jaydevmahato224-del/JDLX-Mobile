import sqlite3
import os

db_paths = ['./backend/jdlx.db', './jdlx.db', './backend/backend/jdlx.db']
found = False
for db_path in db_paths:
    if os.path.exists(db_path):
        print(f"Checking {db_path}...")
        conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='product_reviews'")
    if not cursor.fetchone():
        print("Table product_reviews not found")
    else:
        cursor.execute("SELECT * FROM product_reviews")
        rows = cursor.fetchall()
        print(f"Total reviews: {len(rows)}")
        for row in rows:
            print(row)
    conn.close()
