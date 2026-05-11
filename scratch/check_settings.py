import sqlite3
conn = sqlite3.connect('jdlx.db')
cursor = conn.cursor()
cursor.execute("SELECT * FROM system_settings")
for row in cursor.fetchall():
    print(row)
conn.close()
