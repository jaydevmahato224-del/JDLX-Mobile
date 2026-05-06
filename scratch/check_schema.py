import sqlite3

db_path = "/home/jaydev/Desktop/JDLX-Mobile/jdlx.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("PRAGMA table_info(warehouses)")
    columns = cursor.fetchall()
    print("--- warehouses columns ---")
    for col in columns:
        print(col)

    cursor.execute("PRAGMA table_info(dark_stores)")
    columns = cursor.fetchall()
    print("\n--- dark_stores columns ---")
    for col in columns:
        print(col)

except Exception as e:
    print(f"Error: {e}")
finally:
    conn.close()
