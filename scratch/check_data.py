import sqlite3
db_path = 'backend/jdlx.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()
print("Orders sample:")
try:
    cursor.execute("SELECT id, order_number, customer_name FROM orders LIMIT 3")
    for row in cursor.fetchall():
        print(row)
except Exception as e:
    print(e)
conn.close()
