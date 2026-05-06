import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Create refund_requests table
    print("Creating refund_requests table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS refund_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            status TEXT DEFAULT 'PENDING',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
