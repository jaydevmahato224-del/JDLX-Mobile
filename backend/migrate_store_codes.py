import sqlite3
import random
import os

DATABASE_PATH = 'jdlx.db'

def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def generate_unique_store_code(cursor):
    while True:
        # Generate a 4-digit random ID with DS- prefix
        code = f"DS-{random.randint(1000, 9999)}"
        
        # Check if it exists in dark_stores
        cursor.execute("SELECT id FROM dark_stores WHERE store_code = ?", (code,))
        if cursor.fetchone():
            continue
            
        return code

def migrate():
    if not os.path.exists(DATABASE_PATH):
        print(f"Error: Database file {DATABASE_PATH} not found.")
        return

    conn = get_db()
    cursor = conn.cursor()

    try:
        # Migrate dark_stores (OVERWRITE existing with new 4-digit format)
        cursor.execute("SELECT id, name FROM dark_stores")
        stores = cursor.fetchall()
        print(f"Found {len(stores)} dark stores to update to 4-digit codes.")
        
        for st in stores:
            new_code = generate_unique_store_code(cursor)
            cursor.execute("UPDATE dark_stores SET store_code = ? WHERE id = ?", (new_code, st['id']))
            print(f"Assigned 4-digit Store Code {new_code} to store: {st['name']}")

        conn.commit()
        print("Migration completed successfully.")
        
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {str(e)}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
