import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Create delivery_locations table
    print("Creating delivery_locations table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS delivery_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            delivery_partner_id INTEGER UNIQUE NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (delivery_partner_id) REFERENCES delivery_partners(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
