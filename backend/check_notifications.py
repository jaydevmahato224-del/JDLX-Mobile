import sqlite3
conn = sqlite3.connect('jdlx.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("--- Notifications ---")
cursor.execute("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 10;")
for row in cursor.fetchall():
    print(dict(row))

conn.close()
