import sqlite3

db_path = "/home/jaydev/Desktop/JDLX-Mobile/jdlx.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='warehouse_partners'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(warehouse_partners)")
        columns = cursor.fetchall()
        print("--- warehouse_partners columns ---")
        for col in columns:
            print(col)
    else:
        print("Table warehouse_partners DOES NOT EXIST")

except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
