import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Create payments table
    print("Creating payments table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            payment_method TEXT NOT NULL,
            payment_status TEXT DEFAULT 'PENDING',
            transaction_id TEXT,
            amount REAL NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )
    ''')

    # 2. Add payment_status to orders table if not exists
    try:
        print("Adding payment_status to orders table...")
        cursor.execute("ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'PENDING'")
    except sqlite3.OperationalError:
        print("payment_status column already exists in orders.")

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
