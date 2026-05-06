import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Create user_addresses table
    print("Creating user_addresses table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_addresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            address_text TEXT NOT NULL,
            is_default BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
