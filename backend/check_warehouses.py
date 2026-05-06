import sqlite3
conn = sqlite3.connect('jdlx.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("--- Warehouses ---")
cursor.execute("SELECT id, warehouse_name, owner_email FROM warehouses;")
for row in cursor.fetchall():
    print(dict(row))

conn.close()
