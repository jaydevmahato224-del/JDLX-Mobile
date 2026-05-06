import sqlite3
conn = sqlite3.connect('jdlx.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()
cursor.execute("SELECT * FROM system_settings")
rows = cursor.fetchall()
for row in rows:
    print(f"{row['key']}: {row['value']}")
conn.close()
