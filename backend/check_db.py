import sqlite3
conn = sqlite3.connect('jdlx.db')
cursor = conn.cursor()
cursor.execute("PRAGMA table_info(products)")
cols = [row[1] for row in cursor.fetchall()]
print(f"Columns in products: {cols}")
if 'is_featured' in cols:
    print("is_featured exists")
else:
    print("is_featured MISSING")
conn.close()
