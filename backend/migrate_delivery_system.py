import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    try:
        print("Creating delivery_partners table...")
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS delivery_partners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                status TEXT DEFAULT 'AVAILABLE',
                location TEXT,
                active_order_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        print("Created delivery_partners table.")

        print("Adding delivery_partner_id to orders table...")
        try:
            cursor.execute("ALTER TABLE orders ADD COLUMN delivery_partner_id INTEGER REFERENCES delivery_partners(id)")
            print("Added column: delivery_partner_id")
        except sqlite3.OperationalError as e:
            if "duplicate column name" in str(e).lower():
                print("Column delivery_partner_id already exists, skipping.")
            else:
                raise e

        # Insert some dummy partners for testing
        cursor.execute("SELECT COUNT(*) FROM delivery_partners")
        if cursor.fetchone()[0] == 0:
            print("Seeding initial delivery partners...")
            partners = [
                ("Raju Delivery", "9876543210", "AVAILABLE", "28.6139,77.2090"),
                ("Ramesh Express", "9876543211", "AVAILABLE", "28.6239,77.2190"),
                ("Suresh Logistics", "9876543212", "OFFLINE", "28.6339,77.2290")
            ]
            cursor.executemany("INSERT INTO delivery_partners (name, phone, status, location) VALUES (?, ?, ?, ?)", partners)
            print("Added initial delivery partners.")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
