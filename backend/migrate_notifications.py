import sqlite3
import os

DATABASE_PATH = 'backend/jdlx.db'
if not os.path.exists(DATABASE_PATH):
    DATABASE_PATH = 'jdlx.db'

def migrate():
    print(f"Connecting to database at {DATABASE_PATH}...")
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    # 1. Create notifications table
    print("Creating notifications table...")
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            read_status BOOLEAN DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    ''')

    conn.commit()
    conn.close()
    print("Migration completed successfully!")

if __name__ == "__main__":
    migrate()
