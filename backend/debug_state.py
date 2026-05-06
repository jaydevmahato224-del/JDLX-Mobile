import sqlite3
conn = sqlite3.connect('jdlx.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("--- Products ---")
cursor.execute("SELECT id, name, stock FROM products WHERE name LIKE 'Vivo Mobile%';")
for row in cursor.fetchall():
    print(dict(row))

print("\n--- Cart Table ---")
cursor.execute("SELECT * FROM cart;")
for row in cursor.fetchall():
    print(dict(row))

print("\n--- Users ---")
cursor.execute("SELECT id, name, email FROM users;")
for row in cursor.fetchall():
    print(dict(row))

conn.close()
