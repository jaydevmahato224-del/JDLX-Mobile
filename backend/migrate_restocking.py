import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Add fields to products table
    try:
        print("Adding restock_threshold to products table...")
        cursor.execute("ALTER TABLE products ADD COLUMN restock_threshold INTEGER DEFAULT 10")
    except sqlite3.OperationalError:
        print("restock_threshold column already exists.")
        
    try:
        print("Adding supplier_id to products table...")
        cursor.execute("ALTER TABLE products ADD COLUMN supplier_id INTEGER")
    except sqlite3.OperationalError:
        print("supplier_id column already exists.")

    # 2. Create restock_requests table
    print("Creating restock_requests table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS restock_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            supplier_id INTEGER,
            requested_quantity INTEGER NOT NULL,
            status TEXT DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )
    ''')
    
    # Optional: populate some fake supplier IDs if they are missing
    cursor.execute("UPDATE products SET supplier_id = (id % 3) + 1, restock_threshold = 20 WHERE supplier_id IS NULL")

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
