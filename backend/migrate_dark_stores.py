import sqlite3
import os

DATABASE_PATH = 'jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'backend/jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        print("Creating dark_stores table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS dark_stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                address TEXT NOT NULL,
                active BOOLEAN DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        print("Creating store_inventory table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS store_inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                stock_quantity INTEGER DEFAULT 0,
                FOREIGN KEY(store_id) REFERENCES dark_stores(id),
                FOREIGN KEY(product_id) REFERENCES products(id)
            )
        ''')

        print("Adding store_id to orders table...")
        try:
            cursor.execute("ALTER TABLE orders ADD COLUMN store_id INTEGER REFERENCES dark_stores(id)")
            print("Added column: store_id to orders")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                print("Column store_id already exists in orders, skipping.")
            else:
                raise e

        # Insert some initial dark stores for testing
        cursor.execute("SELECT COUNT(*) FROM dark_stores")
        if cursor.fetchone()[0] == 0:
            print("Seeding initial dark stores...")
            stores = [
                ("Central Hub - New Delhi", 28.6139, 77.2090, "Connaught Place, New Delhi", 1),
                ("South Delhi Depot", 28.5355, 77.2410, "Nehru Place, New Delhi", 1),
                ("East Delhi Point", 28.6280, 77.2782, "Laxmi Nagar, Delhi", 1)
            ]
            cursor.executemany("INSERT INTO dark_stores (name, latitude, longitude, address, active) VALUES (?, ?, ?, ?, ?)", stores)
            print("Added initial dark stores.")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
