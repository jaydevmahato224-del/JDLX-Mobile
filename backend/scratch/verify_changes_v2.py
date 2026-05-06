import sqlite3
import os

# Assuming we run from the backend directory
db_path = 'jdlx.db'

def verify_db_state():
    if not os.path.exists(db_path):
        print(f"Error: {db_path} not found in current directory: {os.getcwd()}")
        return

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Check columns
    cursor.execute("PRAGMA table_info(products)")
    cols = [row['name'] for row in cursor.fetchall()]
    print(f"Columns in products: {cols}")
    
    barcode_exists = 'barcode' in cols
    sku_code_exists = 'global_sku_code' in cols
    
    if barcode_exists and sku_code_exists:
        print("SUCCESS: Columns 'barcode' and 'global_sku_code' exist.")
    else:
        print("FAILURE: Columns missing.")

    # 2. Check UNIQUE constraint on barcode
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='products' AND sql LIKE '%UNIQUE%' AND sql LIKE '%barcode%'")
    index = cursor.fetchone()
    if index:
        print(f"SUCCESS: Unique index on barcode exists: {dict(index)}")
    else:
        # Check if it was defined in CREATE TABLE
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'")
        sql = cursor.fetchone()[0]
        if 'UNIQUE' in sql and 'barcode' in sql:
             print("SUCCESS: Unique constraint on barcode exists in table definition.")
        else:
             print("FAILURE: Unique constraint on barcode NOT found.")

    conn.close()

if __name__ == "__main__":
    verify_db_state()
