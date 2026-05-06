import sqlite3
import random
import os

DATABASE_PATH = 'jdlx.db'

def get_db():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def generate_unique_partner_id(cursor):
    while True:
        # Generate a 6-digit random ID
        partner_id = str(random.randint(100000, 999999))
        
        # Check if it exists in warehouses or warehouse_applications
        cursor.execute("SELECT id FROM warehouses WHERE partner_id = ?", (partner_id,))
        if cursor.fetchone():
            continue
            
        cursor.execute("SELECT id FROM warehouse_applications WHERE partner_id = ?", (partner_id,))
        if cursor.fetchone():
            continue
            
        return partner_id

def migrate():
    if not os.path.exists(DATABASE_PATH):
        print(f"Error: Database file {DATABASE_PATH} not found.")
        return

    conn = get_db()
    cursor = conn.cursor()

    try:
        # 1. Migrate warehouses
        cursor.execute("SELECT id, email FROM warehouses WHERE partner_id IS NULL OR partner_id = ''")
        warehouses = cursor.fetchall()
        print(f"Found {len(warehouses)} warehouses needing partner_id.")
        
        for wh in warehouses:
            new_id = generate_unique_partner_id(cursor)
            cursor.execute("UPDATE warehouses SET partner_id = ? WHERE id = ?", (new_id, wh['id']))
            print(f"Assigned ID {new_id} to warehouse: {wh['email']}")

        # 2. Migrate warehouse applications
        cursor.execute("SELECT id, email FROM warehouse_applications WHERE partner_id IS NULL OR partner_id = ''")
        apps = cursor.fetchall()
        print(f"Found {len(apps)} applications needing partner_id.")
        
        for app in apps:
            new_id = generate_unique_partner_id(cursor)
            cursor.execute("UPDATE warehouse_applications SET partner_id = ? WHERE id = ?", (new_id, app['id']))
            print(f"Assigned ID {new_id} to application: {app['email']}")

        conn.commit()
        print("Migration completed successfully.")
        
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {str(e)}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
