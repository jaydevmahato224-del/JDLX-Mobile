import sqlite3
import os

db_path = 'jdlx.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    for table in tables:
        table_name = table[0]
        print(f"\n--- Table: {table_name} ---")
        cursor.execute(f"PRAGMA table_info({table_name});")
        cols = cursor.fetchall()
        for col in cols:
            print(col)
    conn.close()
else:
    print("Database not found")
