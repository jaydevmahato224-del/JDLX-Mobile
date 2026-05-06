import sqlite3

DATABASE_PATH = "jdlx.db"

def sync_warehouses():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    try:
        print("Starting synchronization of Warehouses to Dark Stores...")
        
        # 1. Fetch all warehouses from the 'warehouses' table
        cursor.execute("SELECT * FROM warehouses")
        warehouses = cursor.fetchall()
        print(f"Found {len(warehouses)} warehouses in total.")
        
        for wh in warehouses:
            name = wh['warehouse_name']
            address = wh['address']
            manager = wh['owner_name']
            phone = wh['phone']
            
            # 2. Check if this warehouse already exists in 'dark_stores'
            cursor.execute("SELECT id FROM dark_stores WHERE name = ?", (name,))
            existing = cursor.fetchone()
            
            if not existing:
                print(f"Syncing: {name}...")
                cursor.execute(
                    """INSERT INTO dark_stores 
                       (name, latitude, longitude, address, manager_name, phone) 
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (name, 0.0, 0.0, address, manager, phone)
                )
                print(f"  - Successfully added {name} to dark_stores.")
            else:
                print(f"Skipping: {name} (already exists in dark_stores with ID {existing['id']})")
        
        conn.commit()
        print("Synchronization complete!")
        
    except Exception as e:
        print(f"Error during synchronization: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    sync_warehouses()
