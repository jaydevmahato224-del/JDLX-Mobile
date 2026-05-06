import sqlite3
conn = sqlite3.connect('jdlx.db')
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

print("--- Notification Templates ---")
cursor.execute("SELECT slug, is_active FROM notification_templates;")
for row in cursor.fetchall():
    print(dict(row))

conn.close()
